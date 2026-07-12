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
