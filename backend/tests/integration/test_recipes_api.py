from __future__ import annotations

import csv

import pytest

# --------------------------------------------------------------------------
# Fixture builders (mirrors tests/unit/test_recipe_service.py)
# --------------------------------------------------------------------------


def _make_pdf_bytes(texts: list[str]) -> bytes:
    import io

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

    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _make_docx_bytes(paragraphs: list[str]) -> bytes:
    import io

    import docx

    document = docx.Document()
    for para in paragraphs:
        document.add_paragraph(para)
    buf = io.BytesIO()
    document.save(buf)
    return buf.getvalue()


def _make_csv_bytes(header: list[str], rows: list[list[str]]) -> bytes:
    import io

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(header)
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


# --------------------------------------------------------------------------
# Full happy path (real pypdf/docx parsing, no mocks)
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pdf_convert_full_happy_path_via_api(client):
    pdf_bytes = _make_pdf_bytes(["Lorem ipsum dolor sit amet. " * 20])

    response = await client.post(
        "/api/v1/recipes/convert",
        files={"file": ("doc.pdf", pdf_bytes, "application/pdf")},
        data={
            "name": "pdf-recipe",
            "output_format": "text",
            "chunk_size": "200",
            "chunk_overlap": "20",
        },
    )
    assert response.status_code == 202
    body = response.json()
    assert body["name"] == "pdf-recipe"
    job_id = body["recipe_job_id"]
    assert job_id.startswith("rj_")

    job_response = await client.get(f"/api/v1/recipes/jobs/{job_id}")
    assert job_response.status_code == 200
    job = job_response.json()
    assert job["status"] == "completed"
    assert job["rows_emitted"] > 0
    assert len(job["preview_rows"]) <= 5
    assert all("text" in row for row in job["preview_rows"])
    assert job["dataset_id"] is not None
    assert job["error"] is None

    datasets_response = await client.get("/api/v1/datasets")
    datasets = datasets_response.json()["datasets"]
    matching = [d for d in datasets if d["dataset_id"] == job["dataset_id"]]
    assert len(matching) == 1
    assert matching[0]["format"] == "text"
    assert matching[0]["row_count"] == job["rows_emitted"]


@pytest.mark.asyncio
async def test_docx_convert_full_happy_path_via_api(client):
    docx_bytes = _make_docx_bytes(["First paragraph.", "Second paragraph."])

    response = await client.post(
        "/api/v1/recipes/convert",
        files={
            "file": (
                "doc.docx",
                docx_bytes,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
        data={"name": "docx-recipe", "output_format": "text"},
    )
    assert response.status_code == 202
    job_id = response.json()["recipe_job_id"]

    job = (await client.get(f"/api/v1/recipes/jobs/{job_id}")).json()
    assert job["status"] == "completed"
    assert job["rows_emitted"] >= 1


@pytest.mark.asyncio
async def test_csv_convert_chat_full_happy_path_via_api(client):
    csv_bytes = _make_csv_bytes(
        ["question", "answer"],
        [["What is MLX?", "An Apple ML framework."], ["What is LoRA?", "Low-rank adaptation."]],
    )

    response = await client.post(
        "/api/v1/recipes/convert",
        files={"file": ("qa.csv", csv_bytes, "text/csv")},
        data={
            "name": "csv-chat-recipe",
            "output_format": "chat",
            "prompt_column": "question",
            "completion_column": "answer",
            "system_prompt": "Be concise.",
        },
    )
    assert response.status_code == 202
    job_id = response.json()["recipe_job_id"]

    job = (await client.get(f"/api/v1/recipes/jobs/{job_id}")).json()
    assert job["status"] == "completed"
    assert job["rows_emitted"] == 2
    first = job["preview_rows"][0]
    assert first["messages"][0] == {"role": "system", "content": "Be concise."}
    assert first["messages"][1] == {"role": "user", "content": "What is MLX?"}
    assert first["messages"][2] == {"role": "assistant", "content": "An Apple ML framework."}

    datasets = (await client.get("/api/v1/datasets")).json()["datasets"]
    matching = [d for d in datasets if d["dataset_id"] == job["dataset_id"]]
    assert matching[0]["format"] == "chat"


# --------------------------------------------------------------------------
# 422s
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wrong_output_format_for_pdf_is_422(client):
    pdf_bytes = _make_pdf_bytes(["some text"])

    response = await client.post(
        "/api/v1/recipes/convert",
        files={"file": ("doc.pdf", pdf_bytes, "application/pdf")},
        data={"name": "bad", "output_format": "chat"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_wrong_output_format_for_csv_is_422(client):
    csv_bytes = _make_csv_bytes(["q", "a"], [["hi", "hello"]])

    response = await client.post(
        "/api/v1/recipes/convert",
        files={"file": ("qa.csv", csv_bytes, "text/csv")},
        data={
            "name": "bad",
            "output_format": "text",
            "prompt_column": "q",
            "completion_column": "a",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_missing_csv_columns_is_422(client):
    csv_bytes = _make_csv_bytes(["prompt", "reply"], [["hi", "hello"]])

    response = await client.post(
        "/api/v1/recipes/convert",
        files={"file": ("qa.csv", csv_bytes, "text/csv")},
        data={
            "name": "bad",
            "output_format": "completions",
            "prompt_column": "question",
            "completion_column": "answer",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert "question" in response.json()["error"]["message"]


@pytest.mark.asyncio
async def test_csv_without_prompt_completion_columns_is_422(client):
    csv_bytes = _make_csv_bytes(["q", "a"], [["hi", "hello"]])

    response = await client.post(
        "/api/v1/recipes/convert",
        files={"file": ("qa.csv", csv_bytes, "text/csv")},
        data={"name": "bad", "output_format": "completions"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_garbage_file_unsupported_extension_is_422(client):
    response = await client.post(
        "/api/v1/recipes/convert",
        files={"file": ("doc.exe", b"not a supported file", "application/octet-stream")},
        data={"name": "bad", "output_format": "text"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_corrupt_pdf_content_fails_as_a_job_not_a_422(client):
    # Correct extension + output_format, but unparseable bytes: this passes
    # synchronous validation and only fails once the background job attempts
    # to actually parse it.
    response = await client.post(
        "/api/v1/recipes/convert",
        files={"file": ("doc.pdf", b"not a real pdf", "application/pdf")},
        data={"name": "corrupt", "output_format": "text"},
    )
    assert response.status_code == 202
    job_id = response.json()["recipe_job_id"]

    job = (await client.get(f"/api/v1/recipes/jobs/{job_id}")).json()
    assert job["status"] == "failed"
    assert job["error"] is not None
    assert job["dataset_id"] is None


# --------------------------------------------------------------------------
# misc
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_recipe_job_not_found(client):
    response = await client.get("/api/v1/recipes/jobs/rj_missing")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
