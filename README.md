
# Signora – Online E-Signature System

## 📌 Project Overview

Signora is a web-based electronic signature (e-signature) system that allows users to upload documents, add signature fields, and send signing requests through email.

Signers can open the secure signing link, view the document, and provide their electronic signature online. Once the signing process is completed, the system generates and stores the signed PDF along with an audit trail.

The main goal of Signora is to make document signing simple, secure, and efficient without requiring physical paperwork.

## ✨ Key Features

- User authentication and login
- Document upload and storage
- Signature field placement
- Email-based signing invitations
- Online electronic document signing
- Signed PDF generation and storage
- Audit trail for document activities

## 👥 Team Members & Responsibilities

| Name | Git Branch | Responsibilities |
|---|---|---|
| Elaveny | `feature/auth-upload` | User authentication, document upload, and file storage |
| Divaranan | `feature/signing-ui` | Signature field placement and signing page UI |
| Kisho | `feature/email-pdf` | Email notifications, signed PDF generation, and audit trail |

## 🔄 Application Workflow

1. **Document Upload:** The user logs into the system and uploads a document.
2. **Signature Placement:** The user places signature fields in the required positions.
3. **Email Invitation:** The system generates a unique signing link and sends it to the signer via email.
4. **Document Signing:** The signer opens the link and electronically signs the document.
5. **Signed PDF Generation:** The system generates and stores the signed PDF.
6. **Audit Trail:** The system records important activities related to the signing process.

## 🌿 Git Branching Strategy

The project follows a feature-based Git branching strategy.

- `main` – Main production branch.
- `feature/auth-upload` – Authentication and document upload.
- `feature/signing-ui` – Signature placement and signing interface.
- `feature/email-pdf` – Email integration, PDF generation, and audit trail.

## 📋 Git Collaboration Rules

1. Direct pushes to the `main` branch are strictly prohibited.
2. Each team member must work on their assigned feature branch.
3. All changes must be submitted through Pull Requests (PRs).
4. Code must be reviewed and approved before merging into `main`.
5. Only one designated team member is responsible for updating and maintaining the README file.
6. Team members should regularly pull the latest changes from `main` to avoid merge conflicts.

## ⚙️ Installation and Setup

Clone the repository:

```bash
git clone <repository-url>
```

Navigate to the project directory:

```bash
cd Signora
```

Switch to your assigned feature branch:

```bash
git checkout feature/auth-upload
```

Install the project dependencies according to the selected technology stack.

Start the development server using the appropriate command for the project.

## 🔐 Security

- Protect user authentication credentials.
- Use secure document storage.
- Generate unique signing links.
- Restrict unauthorized document access.
- Maintain an audit trail of signing activities.

## 📄 License

This project is licensed under the MIT License.

## 🎯 Project Objective

To develop a reliable and user-friendly electronic signature platform that simplifies document management and signing through a secure online workflow.
