# Friends Party: resumen para retomar (2026-10-02)

## Estado
App 1.0 (build 1) enviada a revisión de Apple el 2026-10-01 ("Pendiente de revisión"). Publicación automática al aprobarse. Si Apple responde con rechazo, corregir y reenviar.

## Repos (clonar en el MacBook)
- Web/PWA + backend: https://github.com/henryhall1975/friends-party  (Pages: henryhall1975.github.io/friends-party)
- App nativa iOS (Xcode): https://github.com/henryhall1975/FriendsPartyApp  (privado, bundle id com.henryhall.friendsparty, Team P4242HMZ49)

## Lo que NO viaja por GitHub
- `REVISOR_APPLE.md` (cuenta de revisor de Apple, está en .gitignore): copiarlo a mano o ver App Store Connect > Información de revisión.
- Capturas de App Store: ~/Desktop/FriendsParty_Screenshots_Final (1284x2778).
- Llaves .p8 (APNs e In-App Purchase): solo viven en Supabase > Edge Functions > Secrets; no se necesitan localmente.
- Iniciar sesión otra vez en el MacBook: Xcode (Apple ID), `gh auth login`, Supabase.

## Backend
Supabase proyecto tjsrwipyhrqsvqodrnta. Edge Functions: `send-push`, `verify-purchase` (código en `supabase/functions/`). Las compras reales (Premium + 4 packs de stickers) funcionan con Sandbox.

## Pendiente de más adelante
Traducción ES/EN/KO, enlaces universales para que el QR abra la app, `APPSTORE_URL` vacía en index.html, pantallas plegables, limpieza de videos >7 días en Storage.
