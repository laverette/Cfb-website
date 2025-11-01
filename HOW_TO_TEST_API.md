# Testing Your API - Quick Guide

## Option 1: Thunder Client (VS Code Extension) - EASIEST

1. **Install Thunder Client:**
   - Open VS Code
   - Click Extensions icon (or `Ctrl+Shift+X`)
   - Search "Thunder Client"
   - Click Install

2. **Open Thunder Client:**
   - Click the lightning bolt icon in VS Code sidebar
   - Click "New Request"

3. **Test Registration:**
   - Method: **POST** (dropdown at top)
   - URL: `http://localhost:5000/api/auth/register`
   - Click "Body" tab
   - Select "JSON" (radio button)
   - Paste this:
   ```json
   {
     "username": "testuser",
     "email": "test@test.com",
     "password": "password123"
   }
   ```
   - Click "Send" button
   - You should see a response with a token and user info!

## Option 2: PowerShell Command

Open PowerShell (in any folder) and run:

```powershell
Invoke-RestMethod -Uri "http://localhost:5000/api/auth/register" -Method POST -ContentType "application/json" -Body '{"username":"testuser","email":"test@test.com","password":"password123"}'
```

## What is POST?

- **GET** = Read/Retrieve data (like visiting a webpage)
- **POST** = Send/Create data (like submitting a form)
- **PUT** = Update data
- **DELETE** = Remove data

For registration, we use **POST** because we're creating/sending new user data.


