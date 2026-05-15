# Release Workflow

Bu proje **conventional commits** ve **standard-version** kullanarak otomatik versiyonlama ve release yönetimi yapar.

## Conventional Commits

Her commit mesajı şu formatı takip etmelidir:

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type'lar:

- `feat`: Yeni özellik (MINOR bump)
- `fix`: Bug düzeltme (PATCH bump)
- `perf`: Performans iyileştirme (PATCH bump)
- `docs`: Dokümantasyon değişikliği
- `style`: Kod formatı değişikliği
- `refactor`: Kod yeniden yapılandırma
- `test`: Test ekleme/düzeltme
- `chore`: Bakım işleri
- `ci`: CI konfigürasyon değişikliği

### Breaking Changes:

MAJOR version bump için commit footer'ına `BREAKING CHANGE:` ekleyin:

```bash
git commit -m "feat: new API structure

BREAKING CHANGE: API endpoints have changed"
```

## Release İşlemleri

### 1. Otomatik Versiyon Belirleme (Önerilen)

Standard-version commit geçmişine bakarak otomatik versiyon belirler:

```bash
npm run release
```

Bu komut:
- Conventional commits'e göre versiyon belirler
- CHANGELOG.md günceller
- package.json ve package-lock.json'da versiyon günceller
- Git commit ve tag oluşturur

### 2. Manuel Versiyon Belirleme

#### Patch Release (1.5.0 → 1.5.1)
```bash
npm run release:patch
```

#### Minor Release (1.5.0 → 1.6.0)
```bash
npm run release:minor
```

#### Major Release (1.5.0 → 2.0.0)
```bash
npm run release:major
```

### 3. Beta Release

Beta sürüm için:

```bash
npm run release:beta
```

Örnek: `1.5.0` → `1.5.1-beta.0`

Tekrar çalıştırırsanız: `1.5.1-beta.0` → `1.5.1-beta.1`

## GitHub Actions ve NPM Yayını

Release komutu çalıştırıldıktan sonra:

```bash
# Tag'i GitHub'a push et
git push --follow-tags origin main
```

Bu işlem:
1. GitHub Actions tetiklenir
2. Tests ve linter çalışır
3. Package build edilir
4. GitHub Release oluşturulur
5. NPM'e yayınlanır (beta ise `@beta` tag ile, stable ise `@latest` tag ile)

## Örnek Workflow

### Stable Release:

```bash
# 1. Feature branch'te çalış
git checkout -b feature/new-payment-provider

# 2. Değişiklikleri yap
git add .
git commit -m "feat: add new payment provider support"

# 3. Main'e merge et
git checkout main
git merge feature/new-payment-provider

# 4. Release oluştur
npm run release

# 5. Push et
git push --follow-tags origin main
```

### Beta Release:

```bash
# 1. Beta branch'te çalış
git checkout beta

# 2. Değişiklikleri yap
git add .
git commit -m "feat: experimental feature"

# 3. Beta release oluştur
npm run release:beta

# 4. Push et
git push --follow-tags origin beta
```

## CHANGELOG

Standard-version otomatik olarak CHANGELOG.md günceller. Changelog formatı:

```markdown
## [1.6.0](https://github.com/tsmart-team/payfyio/compare/v1.5.0...v1.6.0) (2025-11-22)

### ✨ Features

* add new payment provider ([abc1234](https://github.com/tsmart-team/payfyio/commit/abc1234))

### 🐛 Bug Fixes

* fix payment validation ([def5678](https://github.com/tsmart-team/payfyio/commit/def5678))
```

## NPM Tag Yönetimi

### Mevcut tag'leri görüntüle:
```bash
npm dist-tag ls payfyio
```

### Tag değiştir:
```bash
npm dist-tag add payfyio@1.6.0 latest
```

## Troubleshooting

### Release iptal etme:

```bash
# Son commit'i geri al (henüz push edilmediyse)
git reset --hard HEAD~1

# Tag'i sil
git tag -d v1.6.0
```

### Yanlış tag'i silme:

```bash
# Lokal tag'i sil
git tag -d v1.6.0

# Remote tag'i sil
git push origin :refs/tags/v1.6.0
```
