# Changelog — Unauthorized fix via JWT (middleware assist)
- Added `jsonwebtoken` and `JWT_SECRET` support.
- Login issues JWT instead of random token.
- Added global middleware: verifies JWT on every request and seeds TOKENS.add(token) so existing isAuthed() passes.
- No invasive changes to route/middleware structure to avoid syntax errors.
