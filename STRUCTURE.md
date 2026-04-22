# Project Structure

This project is organized by feature and responsibility to keep navigation clear and scaling predictable.

## Directory Layout

```text
/
|- admin.html
|- index.html
|- register.html
|- firebase.json
|- assets/
|- css/
|  |- shared/
|  |  |- main.css
|  |  |- buttons.css
|  |  |- components.css
|  |  \- frames.css
|  \- features/
|     |- auth/
|     |  \- auth.css
|     |- community/
|     |  \- community.css
|     |- home/
|     |  \- home.css
|     |- profile/
|     |  |- id-card.css
|     |  \- profile.css
|     \- services/
|        \- services.css
|- js/
|  |- core/
|  |  |- firebase-config.js
|  |  |- db-paths.js
|  |  \- storage.js
|  |- shared/
|  |  |- comments.js
|  |  |- image-viewer.js
|  |  |- lastSeen.js
|  |  |- location.js
|  |  |- nav-auth.js
|  |  |- notifications.js
|  |  |- stat-counter.js
|  |  \- weather.js
|  \- features/
|     |- admin/
|     |  |- admin.js
|     |  |- alerts-admin.js
|     |  |- bulletin-admin.js
|     |  |- comment-manager-admin.js
|     |  |- community-posts-admin.js
|     |  |- curfew-admin.js
|     |  |- reported-comments-admin.js
|     |  |- reported-posts-admin.js
|     |  |- roles-admin.js
|     |  \- settings-admin.js
|     |- auth/
|     |  |- auth.js
|     |  \- register.js
|     |- community/
|     |  |- bulletin.js
|     |  |- community-animations.js
|     |  \- community-posts.js
|     |- home/
|     |  \- home-animations.js
|     \- profile/
|        |- alerts.js
|        \- profile.js
|- pages/
|  |- features/
|  |  |- community.html
|  |  |- home.html
|  |  |- profile.html
|  |  \- services.html
|  |- community.html   (legacy redirect)
|  |- home.html        (legacy redirect)
|  |- profile.html     (legacy redirect)
|  \- services.html    (legacy redirect)
|- ui-library/
|  |- button-library.html
|  |- components-library.html
|  |- frames-library.html
|  \- main-library.html
|- public/
\- functions/
```

## JS Module Responsibilities

- `js/core`: shared infrastructure used across all features.
  - Firebase app/auth/db/storage bootstrap.
  - DB path builders and storage helpers.
- `js/shared`: reusable cross-feature client behavior.
  - Navigation auth wiring, notifications, image viewing, comments, etc.
- `js/features/*`: feature-specific modules only.
  - Admin, auth, community, home, profile.

## Naming Rules

- Keep explicit, context-rich names.
- Admin scripts must remain `*-admin.js`.
- Feature-specific files should keep feature prefixes where applicable:
  - `home-*`, `community-*`, `profile-*`, etc.
- Avoid ambiguous/generic names such as:
  - `script.js`
  - `animations.js`
  - `main.js` (unless truly global)

## Path Conventions

- HTML pages under `pages/features/` should reference shared assets with `../../`.
- JS imports follow module placement:
  - Feature module -> core/shared uses `../../core/...` or `../../shared/...`
  - Shared module -> core/shared uses `../core/...` or `./...`
  - Core module -> core uses `./...`
- Legacy URL support is maintained for:
  - `pages/*.html` (redirect stubs to `pages/features/*.html`)
  - `/library/*` routes (rewritten to `/ui-library/*` in `firebase.json`)

## Expansion Guidelines

- Add new domain logic under `js/features/<feature>/`.
- Add reusable logic only when used by multiple features, then place in `js/shared/`.
- Keep Firebase primitives centralized in `js/core/`.
- Add feature styles in `css/features/<feature>/`, not in shared styles, unless reused globally.
