from __future__ import annotations

import csv
from pathlib import Path

import aiosqlite
import pytest
from starlette.background import BackgroundTasks

from app.config import Settings, get_settings
from app.core.errors import NotFoundError, ValidationAppError
from app.db.database import init_db
from app.db.repositories import DatasetsRepo
from app.services.recipe_service import (
    RecipeService,
    chunk_text,
    emit_csv_rows,
    extract_text,
    read_csv_rows,
)

# --------------------------------------------------------------------------
# Fixture builders
# --------------------------------------------------------------------------


def _make_pdf(path: Path, texts: list[str]) -> None:
    """Builds a minimal multi-page PDF with real extractable text, one page
    per string in `texts`. No reportlab dependency: writes the content
    stream (Tj operator) directly via pypdf's low-level object API."""
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    writer = PdfWriter()
    for text in texts:
        page = writer.add_blank_page(width=300, height=300)

        escaped = text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
        content = f"BT /F1 12 Tf 20 100 Td ({escaped}) Tj ET".encode()
        stream = DecodedStreamObject()
        stream.set_data(content)
        stream_ref = writer._add_object(stream)

        font = DictionaryObject()
        font[NameObject("/Type")] = NameObject("/Font")
        font[NameObject("/Subtype")] = NameObject("/Type1")
        font[NameObject("/BaseFont")] = NameObject("/Helvetica")
        font_ref = writer._add_object(font)

        resources = DictionaryObject()
        font_dict = DictionaryObject()
        font_dict[NameObject("/F1")] = font_ref
        resources[NameObject("/Font")] = font_dict

        page[NameObject("/Resources")] = resources
        page[NameObject("/Contents")] = stream_ref

    with path.open("wb") as fh:
        writer.write(fh)


def _make_docx(path: Path, paragraphs: list[str]) -> None:
    import docx

    document = docx.Document()
    for para in paragraphs:
        document.add_paragraph(para)
    document.save(str(path))


def _make_csv(path: Path, header: list[str], rows: list[list[str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        writer.writerows(rows)


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------


class TestExtraction:
    def test_extract_pdf_joins_page_texts(self, tmp_path):
        path = tmp_path / "doc.pdf"
        _make_pdf(path, ["Hello world", "Second page text"])

        text = extract_text(path, ".pdf")

        assert "Hello world" in text
        assert "Second page text" in text

    def test_extract_docx_joins_paragraph_texts(self, tmp_path):
        path = tmp_path / "doc.docx"
        _make_docx(path, ["First paragraph.", "Second paragraph."])

        text = extract_text(path, ".docx")

        assert "First paragraph." in text
        assert "Second paragraph." in text

    def test_extract_txt_reads_raw_content(self, tmp_path):
        path = tmp_path / "doc.txt"
        path.write_text("plain text content\nwith a newline", encoding="utf-8")

        assert extract_text(path, ".txt") == "plain text content\nwith a newline"

    def test_extract_md_reads_raw_content(self, tmp_path):
        path = tmp_path / "doc.md"
        path.write_text("# Heading\n\nBody text.", encoding="utf-8")

        assert extract_text(path, ".md") == "# Heading\n\nBody text."


# --------------------------------------------------------------------------
# Chunking
# --------------------------------------------------------------------------


class TestChunkText:
    def test_empty_text_returns_no_chunks(self):
        assert chunk_text("", chunk_size=500, chunk_overlap=50) == []
        assert chunk_text("   \n  ", chunk_size=500, chunk_overlap=50) == []

    def test_short_document_returns_single_chunk(self):
        text = "Just a short paragraph."
        chunks = chunk_text(text, chunk_size=500, chunk_overlap=50)
        assert chunks == [text]

    def test_respects_chunk_size_for_long_paragraph(self):
        # A single paragraph far longer than chunk_size must be windowed.
        text = "word " * 400  # ~2000 chars, one paragraph (no blank lines)
        chunks = chunk_text(text, chunk_size=300, chunk_overlap=50)
        assert len(chunks) > 1
        assert all(len(c) <= 300 for c in chunks)

    def test_overlap_present_between_consecutive_chunks(self):
        text = "word " * 400
        chunks = chunk_text(text, chunk_size=300, chunk_overlap=50)
        # The tail of chunk[i] should reappear at the head of chunk[i+1].
        tail = chunks[0][-50:]
        assert chunks[1].startswith(tail)

    def test_splits_on_paragraph_boundaries_when_possible(self):
        para_a = "A" * 100
        para_b = "B" * 100
        para_c = "C" * 100
        text = f"{para_a}\n\n{para_b}\n\n{para_c}"
        chunks = chunk_text(text, chunk_size=220, chunk_overlap=0)
        # para_a + para_b fit in one chunk (100+2+100=202 <= 220); para_c on its own.
        assert chunks[0] == f"{para_a}\n\n{para_b}"
        assert chunks[1] == para_c

    def test_zero_overlap_produces_no_duplicated_content(self):
        text = "word " * 400
        chunks = chunk_text(text, chunk_size=300, chunk_overlap=0)
        assert "".join(chunks) == text[: len("".join(chunks))]

    def test_overlap_greater_or_equal_to_chunk_size_is_ignored(self):
        # Defensive: pathological overlap >= chunk_size must not infinite-loop
        # or break chunk_size — it's silently treated as zero overlap.
        text = "word " * 400
        chunks = chunk_text(text, chunk_size=300, chunk_overlap=300)
        assert all(len(c) <= 300 for c in chunks)


# --------------------------------------------------------------------------
# CSV reading + emitters
# --------------------------------------------------------------------------


class TestCsvEmitters:
    def test_read_csv_rows_returns_fieldnames_and_rows(self, tmp_path):
        path = tmp_path / "data.csv"
        _make_csv(path, ["question", "answer"], [["What is MLX?", "An Apple ML framework."]])

        fieldnames, rows = read_csv_rows(path)

        assert fieldnames == ["question", "answer"]
        assert rows == [{"question": "What is MLX?", "answer": "An Apple ML framework."}]

    def test_emit_completions_format(self):
        rows = [{"q": "What is 2+2?", "a": "4"}]
        emitted = emit_csv_rows(rows, "completions", "q", "a", None)
        assert emitted == [{"prompt": "What is 2+2?", "completion": "4"}]

    def test_emit_chat_format_without_system_prompt(self):
        rows = [{"q": "hi", "a": "hello"}]
        emitted = emit_csv_rows(rows, "chat", "q", "a", None)
        assert emitted == [
            {
                "messages": [
                    {"role": "user", "content": "hi"},
                    {"role": "assistant", "content": "hello"},
                ]
            }
        ]

    def test_emit_chat_format_with_system_prompt(self):
        rows = [{"q": "hi", "a": "hello"}]
        emitted = emit_csv_rows(rows, "chat", "q", "a", "Be concise.")
        assert emitted[0]["messages"][0] == {"role": "system", "content": "Be concise."}

    def test_emit_skips_rows_with_blank_prompt_or_completion(self):
        rows = [
            {"q": "hi", "a": "hello"},
            {"q": "", "a": "no prompt"},
            {"q": "no completion", "a": ""},
        ]
        emitted = emit_csv_rows(rows, "completions", "q", "a", None)
        assert len(emitted) == 1


# --------------------------------------------------------------------------
# RecipeService: request validation
# --------------------------------------------------------------------------


class TestValidateRequest:
    def setup_method(self):
        self.service = RecipeService()

    def test_pdf_requires_text_output_format(self):
        with pytest.raises(ValidationAppError):
            self.service._validate_request(".pdf", "completions", 2000, 200, None, None)

    def test_pdf_with_text_format_is_accepted(self):
        self.service._validate_request(".pdf", "text", 2000, 200, None, None)

    def test_csv_requires_completions_or_chat_format(self):
        with pytest.raises(ValidationAppError):
            self.service._validate_request(".csv", "text", 2000, 200, "q", "a")

    def test_csv_requires_prompt_and_completion_columns(self):
        with pytest.raises(ValidationAppError):
            self.service._validate_request(".csv", "completions", 2000, 200, None, "a")
        with pytest.raises(ValidationAppError):
            self.service._validate_request(".csv", "completions", 2000, 200, "q", None)

    def test_unsupported_extension_rejected(self):
        with pytest.raises(ValidationAppError):
            self.service._validate_request(".exe", "text", 2000, 200, None, None)

    def test_chunk_overlap_must_be_less_than_chunk_size(self):
        with pytest.raises(ValidationAppError):
            self.service._validate_request(".txt", "text", 200, 200, None, None)

    def test_chunk_size_below_minimum_rejected(self):
        with pytest.raises(ValidationAppError):
            self.service._validate_request(".txt", "text", 10, 0, None, None)


# --------------------------------------------------------------------------
# RecipeService: full end-to-end job lifecycle (real parsing, no mocks)
# --------------------------------------------------------------------------


# These lifecycle tests exercise the *real* dataset registration path
# (RecipeService -> DatasetService.upload), so they rely on the `data_dir`
# fixture from tests/conftest.py (sets MLXLF_DATA_DIR + clears the
# get_settings() cache) rather than constructing a standalone Settings
# object -- DatasetService always resolves settings via the process-wide
# get_settings() cache, not constructor injection.
@pytest.fixture
async def settings(data_dir) -> Settings:
    s = get_settings()
    for d in (s.data_dir, s.models_dir, s.datasets_dir, s.runs_dir, s.exports_dir, s.cache_dir):
        d.mkdir(parents=True, exist_ok=True)
    await init_db(s.db_path)
    return s


@pytest.fixture
async def conn(settings):
    async with aiosqlite.connect(settings.db_path) as c:
        c.row_factory = aiosqlite.Row
        yield c


def _upload_file(path: Path, filename: str):
    from fastapi import UploadFile

    return UploadFile(file=path.open("rb"), filename=filename)


class TestRecipeServiceLifecycle:
    @pytest.mark.asyncio
    async def test_pdf_conversion_end_to_end_registers_dataset(self, settings, conn, tmp_path):
        pdf_path = tmp_path / "doc.pdf"
        long_para = "Lorem ipsum dolor sit amet. " * 30
        _make_pdf(pdf_path, [long_para])

        service = RecipeService()
        bg = BackgroundTasks()
        result = await service.start_convert(
            conn,
            bg,
            file=_upload_file(pdf_path, "doc.pdf"),
            name="pdf-recipe",
            output_format="text",
            chunk_size=200,
            chunk_overlap=20,
            prompt_column=None,
            completion_column=None,
            system_prompt=None,
        )
        assert result["recipe_job_id"].startswith("rj_")
        await bg()

        job = await service.get_job(conn, result["recipe_job_id"])
        assert job.status == "completed"
        assert job.rows_emitted > 0
        assert job.preview_rows
        assert all("text" in row for row in job.preview_rows)
        assert job.dataset_id is not None

        datasets = await DatasetsRepo(conn).list_()
        assert any(d["id"] == job.dataset_id and d["format"] == "text" for d in datasets)

    @pytest.mark.asyncio
    async def test_docx_conversion_end_to_end(self, settings, conn, tmp_path):
        docx_path = tmp_path / "doc.docx"
        _make_docx(docx_path, ["Paragraph one is here.", "Paragraph two follows it."])

        service = RecipeService()
        bg = BackgroundTasks()
        result = await service.start_convert(
            conn,
            bg,
            file=_upload_file(docx_path, "doc.docx"),
            name="docx-recipe",
            output_format="text",
            chunk_size=2000,
            chunk_overlap=200,
            prompt_column=None,
            completion_column=None,
            system_prompt=None,
        )
        await bg()

        job = await service.get_job(conn, result["recipe_job_id"])
        assert job.status == "completed"
        assert job.rows_emitted == 1
        assert "Paragraph one is here." in job.preview_rows[0]["text"]

    @pytest.mark.asyncio
    async def test_csv_conversion_end_to_end_completions(self, settings, conn, tmp_path):
        csv_path = tmp_path / "qa.csv"
        _make_csv(
            csv_path,
            ["question", "answer"],
            [["What is MLX?", "An Apple ML framework."], ["What is LoRA?", "Low-rank adaptation."]],
        )

        service = RecipeService()
        bg = BackgroundTasks()
        result = await service.start_convert(
            conn,
            bg,
            file=_upload_file(csv_path, "qa.csv"),
            name="csv-recipe",
            output_format="completions",
            chunk_size=2000,
            chunk_overlap=200,
            prompt_column="question",
            completion_column="answer",
            system_prompt=None,
        )
        await bg()

        job = await service.get_job(conn, result["recipe_job_id"])
        assert job.status == "completed"
        assert job.rows_emitted == 2
        assert job.preview_rows[0] == {
            "prompt": "What is MLX?",
            "completion": "An Apple ML framework.",
        }

        datasets = await DatasetsRepo(conn).list_()
        assert any(d["id"] == job.dataset_id and d["format"] == "completions" for d in datasets)

    @pytest.mark.asyncio
    async def test_missing_csv_columns_raises_422_before_job_starts(self, settings, conn, tmp_path):
        csv_path = tmp_path / "qa.csv"
        _make_csv(csv_path, ["prompt", "reply"], [["hi", "hello"]])

        service = RecipeService()
        bg = BackgroundTasks()
        with pytest.raises(ValidationAppError):
            await service.start_convert(
                conn,
                bg,
                file=_upload_file(csv_path, "qa.csv"),
                name="bad-csv",
                output_format="completions",
                chunk_size=2000,
                chunk_overlap=200,
                prompt_column="question",
                completion_column="answer",
                system_prompt=None,
            )

    @pytest.mark.asyncio
    async def test_wrong_output_format_for_file_type_raises_422(self, settings, conn, tmp_path):
        txt_path = tmp_path / "doc.txt"
        txt_path.write_text("some text", encoding="utf-8")

        service = RecipeService()
        bg = BackgroundTasks()
        with pytest.raises(ValidationAppError):
            await service.start_convert(
                conn,
                bg,
                file=_upload_file(txt_path, "doc.txt"),
                name="bad-format",
                output_format="chat",
                chunk_size=2000,
                chunk_overlap=200,
                prompt_column=None,
                completion_column=None,
                system_prompt=None,
            )

    @pytest.mark.asyncio
    async def test_corrupt_pdf_marks_job_failed(self, settings, conn, tmp_path):
        garbage_path = tmp_path / "doc.pdf"
        garbage_path.write_bytes(b"not a real pdf")

        service = RecipeService()
        bg = BackgroundTasks()
        result = await service.start_convert(
            conn,
            bg,
            file=_upload_file(garbage_path, "doc.pdf"),
            name="corrupt-pdf",
            output_format="text",
            chunk_size=2000,
            chunk_overlap=200,
            prompt_column=None,
            completion_column=None,
            system_prompt=None,
        )
        await bg()

        job = await service.get_job(conn, result["recipe_job_id"])
        assert job.status == "failed"
        assert job.error is not None
        assert job.dataset_id is None

    @pytest.mark.asyncio
    async def test_get_job_missing_raises_404(self, conn):
        service = RecipeService()
        with pytest.raises(NotFoundError):
            await service.get_job(conn, "rj_missing")
