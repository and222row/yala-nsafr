# يلا نسافر — Flutter App Setup

## Prerequisites
- Flutter SDK >= 3.19 (dart >= 3.3)
- Android Studio or VS Code with Flutter extension
- Android emulator or physical device

## First-time setup

### 1. Generate platform folders
The `lib/` source code is ready. You need Flutter to scaffold the native wrappers:

```bash
cd mobile
flutter create . --project-name yala_nsafr --org com.yalansafr
```

This generates `android/`, `ios/`, `web/`, etc. without touching any existing files in `lib/`.

### 2. Add Cairo font files
Download the Cairo font from Google Fonts and place the TTF files at:

```
mobile/assets/fonts/Cairo-Regular.ttf
mobile/assets/fonts/Cairo-Medium.ttf
mobile/assets/fonts/Cairo-SemiBold.ttf
mobile/assets/fonts/Cairo-Bold.ttf
```

Or run:
```bash
# From mobile/ directory
flutter pub add google_fonts   # alternative: just use the CDN font via google_fonts package
```

If you prefer the `google_fonts` package instead of bundled assets, update `app_theme.dart`
to use `GoogleFonts.cairoTextTheme()`.

### 3. Install dependencies
```bash
flutter pub get
```

### 4. Start the backend
```bash
cd ../backend
docker compose up -d     # starts PostgreSQL + Redis
npm run start:dev
```

### 5. Run the app
```bash
cd ../mobile
flutter run
```

The app connects to `http://10.0.2.2:3000/api/v1` — the standard Android emulator
address for your machine's localhost. For a physical device, change the base URL in
`lib/core/api/api_client.dart` to your machine's LAN IP (e.g. `http://192.168.1.x:3000/api/v1`).

## Project structure

```
lib/
  main.dart                         # App entry point
  core/
    api/
      api_client.dart               # Dio + JWT interceptor
      api_endpoints.dart            # All URL constants
    models/                         # Dart model classes
    router/app_router.dart          # GoRouter with auth guard
    theme/app_theme.dart            # Brand colors + Material 3 theme
  features/
    auth/                           # OTP login flow
    trips/                          # Search, post, my-trips
    bookings/                       # Confirm, my-bookings
    profile/                        # View, edit, ID/driver verification
    disputes/                       # List + detail
  shared/widgets/                   # AppButton, RatingStars, VerifiedBadge
```
