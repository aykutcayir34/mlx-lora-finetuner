# mlx-lora-finetuner

Apple Silicon üzerinde MLX ile LoRA fine-tuning yapan bir Python uygulaması.
(Proje yeni — yapı oturdukça bu dosyayı güncelle.)

## Çalışma şekli

- Bağımsız kodlama işlerini `coder` subagent'ına devret; birbirinden
  bağımsız parçaları paralel coder'lara dağıt ve onlar çalışırken sen
  çalışmaya devam et. Bir subagent yoldan çıkarsa veya bağlam eksikse müdahale et.
- Her önemli özellik bittiğinde `verifier` subagent'ı ile spesifikasyona
  karşı doğrula. Taze bağlamlı doğrulayıcı, öz-eleştiriden daha güvenilirdir.
- Tek dosyalık küçük düzeltmeleri doğrudan kendin yap, subagent açma.
- İlerleme raporlarını bu oturumdaki araç sonuçlarına dayandır; doğrulanmamış
  bir şeyi doğrulanmış gibi sunma.
- Görevin gerektirdiğinin ötesinde özellik, soyutlama veya refactor ekleme.

## Proje yapısı

Monorepo: `backend/` (FastAPI, `uv` ile yönetilir, `app/api|core|db|schemas|
services|training` alt paketleri) + `frontend/` (React/TS/Vite, `src/pages|
components|api|stores`). Kapsamlı modül haritası ve tasarım kararları için
`docs/architecture.md`'ye bak.

- **Sözleşme-önce**: `docs/api.md` dondurulmuş frontend/backend sözleşmesidir.
  Her router ve her query hook/TS tipi ona uymak zorunda. Davranış değişikliği
  önce `docs/api.md`'yi güncelleyen ayrı bir commit ile başlar, koddan değil.
- **Test komutları**: `make test` (`pytest` + `vitest`), `make lint` (`ruff
  check` + `tsc --noEmit`), `make e2e` (gerçek modelle uçtan uca; Apple Silicon
  + ağ gerektirir, varsayılan `make test` döngüsünün parçası değildir).
- **mlx importları lazy olmalı**: `training/worker.py` ve
  `services/inference_service.py` gibi mlx'e dokunan modüller `mlx`/`mlx_lm`/
  `mlx_lm_lora`'yı modül seviyesinde import ETMEZ — her giriş noktası bir
  `_*_fn`/`_import_*` fonksiyonu arkasında saklanır. CI Linux runner'da mlx
  kurulu olmadan çalışır; bu kuralı bozan bir import backend test suite'ini
  Linux'ta patlatır.
- **Tek-eğitim-işi kilidi**: Aynı anda yalnızca bir training job
  `queued`/`running` olabilir (`JobManager`, `409 training_active`). Export ve
  chat da training aktifken aynı hatayı döner — hepsi aynı Metal GPU belleğini
  paylaşır, eşzamanlı ağır MLX işleri güvenilir şekilde çakışır.
- **Veri dizini**: Tüm kalıcı durum `MLXLF_DATA_DIR` altında (varsayılan
  `~/.mlx-lora-finetuner`) — `models/`, `datasets/`, `runs/`, `exports/`,
  `cache/`, `app.db`. Ayrıntılı düzen için README'deki "Data directory
  layout" bölümüne bak.
