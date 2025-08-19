# Student Marks Upload (React + Node + MS Access)

Small POC to add students, upload an Excel marksheet per student, and store the file path in MS Access.

Stack

UI: React (Vite), react-table@7, xlsx
API: Node 18+ (ESM), Express, Multer, ODBC, CORS, Morgan
DB: MS Access .accdb via Microsoft Access ODBC driver (Windows)

Backend Setup (API):
cd C:\codes\Student_db\server
npm init -y
npm i express body-parser cors morgan multer odbc

Endpoints:
GET /students
POST /students { firstName, lastName, marksFilePath? }
POST /upload/:rollNumber (form-data file)
GET /marksheets/... (static files)
Note: Access ODBC has weak param support; server.js uses escaped SQL strings (ok for POC).

Frontend Setup (UI):
npm create vite@latest . -- --template react
npm i
npm i react-table@7 xlsx --legacy-peer-deps

Place:
public/template.xlsx (downloaded by the app)
public/styles.css (CSS provided)

Run:
npm run dev
# http://localhost:5173

How to Use:
Add Row → type First/Last name (buffered editor).
Save → gets real RollNumber from Access.
Upload Marks → Excel saved to Marksheets/<RollNumber>/..., DB path updated.
Filter/sort/paginate via table header/controls.
Download Template → /template.xlsx.

Troubleshooting (short)
ODBC params error: use provided server.js (escaped SQL, no ? params).
Blank page / URI malformed: ensure CSS in /public/styles.css and link it as /styles.css.
Modal behind header: CSS uses .modal-overlay{ z-index:9999 }.
react-table peer deps: install with --legacy-peer-deps or use React 18.
