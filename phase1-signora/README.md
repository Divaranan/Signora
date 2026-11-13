# Signora – Phase 1 (Elaveny)

Full-stack starter for User Authentication, PDF Upload, and Document Dashboard.

## Stack
- Go 1.22+ REST API
- Next.js 15 + TypeScript
- PostgreSQL
- JWT + bcrypt password hashing
- Go multipart file handling (Multer equivalent)
- Local PDF storage in `backend/uploads`

## 1. PostgreSQL setup
Create a database named `signora_db`, then run:

```bash
psql -U postgres -d signora_db -f backend/schema.sql
```

You can also open `backend/schema.sql` in pgAdmin Query Tool and execute it after selecting `signora_db`.

## 2. Start Go backend
Open terminal in `backend`:

```bash
cp .env.example .env
# Edit DATABASE_URL and JWT_SECRET in .env
# PowerShell users: set environment variables manually, or use a dotenv loader.
go mod tidy
go run ./cmd/server
```

For PowerShell, before `go run`:

```powershell
$env:PORT="8080"
$env:DATABASE_URL="postgres://postgres:YOUR_PASSWORD@localhost:5432/signora_db?sslmode=disable"
$env:JWT_SECRET="use-a-long-random-secret-here"
$env:FRONTEND_URL="http://localhost:3000"
$env:UPLOAD_DIR="./uploads"
go run ./cmd/server
```

Backend health check: http://localhost:8080/health

## 3. Start Next.js frontend
Open a second terminal in `frontend`:

```bash
npm install
```
Copy `.env.local.example` to `.env.local`, then:

```bash
npm run dev
```

Open http://localhost:3000

## API endpoints

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | No | Create account |
| POST | `/api/auth/login` | No | Login and receive JWT |
| GET | `/api/auth/me` | Yes | Current user |
| POST | `/api/documents/upload` | Yes | Upload PDF (20MB max) |
| GET | `/api/documents` | Yes | List current user's documents |
| GET | `/api/documents/{id}/view` | Yes | View PDF inline |
| GET | `/api/documents/{id}/download` | Yes | Download PDF |
| DELETE | `/api/documents/{id}` | Yes | Delete own document |

## Notes
- Passwords are stored as bcrypt hashes.
- JWT expiry is 7 days.
- Every document query checks the authenticated owner ID.
- Upload validation checks extension, PDF magic header, and 20MB size limit.
- This starter stores PDFs on local disk. For production deployment, use private object storage and HTTPS.
- Frontend stores JWT in localStorage for simplicity in this learning project. For production, prefer secure HttpOnly cookies and add rate limiting/CSRF protections.
- Email, signing workflow, PDF signature placement, and audit trail are Phase 2/3, not included here.
