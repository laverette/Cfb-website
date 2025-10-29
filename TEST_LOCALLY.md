# Step 2: Test Database Connection Locally

## Commands to Run:

1. **Restore NuGet packages:**
   ```bash
   dotnet restore
   ```

2. **Build the project:**
   ```bash
   dotnet build
   ```

3. **Run the API:**
   ```bash
   dotnet run
   ```

## What to Expect:

- The API should start and connect to MySQL
- You'll see output like:
  ```
  info: Microsoft.Hosting.Lifetime[14]
        Now listening on: http://localhost:5000
        Now listening on: https://localhost:5001
  ```

## If You Get Errors:

- **Connection errors**: Check your MySQL connection string in `appsettings.json`
- **Build errors**: Make sure MySqlConnector package is installed
- **Port conflicts**: Kill any process using ports 5000/5001

## Once Running:

Test the registration endpoint:
- Open Postman, Thunder Client, or use curl
- POST to: `http://localhost:5000/api/auth/register`
- Body (JSON):
  ```json
  {
    "username": "testuser",
    "email": "test@test.com",
    "password": "password123"
  }
  ```

Share any errors if they occur!

