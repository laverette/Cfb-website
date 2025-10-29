# Railway Deployment Guide for CFB Picks API

## Prerequisites
- GitHub account
- Railway account (sign up at https://railway.app)
- Your MySQL database already set up on Heroku JawsDB

## Step 1: Prepare Your Code Repository

1. Make sure your code is pushed to GitHub
2. Ensure your `api` folder contains:
   - `api.csproj`
   - `Program.cs`
   - `Controllers/`
   - `Models/`
   - `Services/`
   - `appsettings.json`

## Step 2: Create Railway Account & Project

1. Go to https://railway.app
2. Sign up with GitHub (recommended)
3. Click "New Project"
4. Select "Deploy from GitHub repo"
5. Choose your repository

## Step 3: Configure Build Settings

Railway should auto-detect .NET, but verify:

1. Go to your project settings
2. Under "Build Command", Railway should auto-detect: `dotnet build`
3. Under "Start Command", set: `dotnet run --project api/api.csproj --urls http://0.0.0.0:$PORT`

**OR** if Railway auto-detects, it should work automatically.

## Step 4: Set Environment Variables

In Railway dashboard, go to your service → Variables tab, add:

```
ConnectionStrings__DefaultConnection=Server=etdq12exrvdjisg6.cbetxkdyhwsb.us-east-1.rds.amazonaws.com;Port=3306;Database=c86v9vfflniegysr;User=x8kicio7cckzkrin;Password=jv3nfhqf64jj44m4;
Jwt__Key=YourSuperSecretKeyThatIsAtLeast32CharactersLong!
Jwt__Issuer=CFBPicks
Jwt__Audience=CFBPicksUsers
Jwt__ExpiryMinutes=1440
ASPNETCORE_ENVIRONMENT=Production
ASPNETCORE_URLS=http://0.0.0.0:$PORT
```

**Note**: Use double underscores `__` for nested config (Railway converts these to `.`)

## Step 5: Deploy

1. Railway will automatically start building and deploying
2. Check the "Deployments" tab for build logs
3. Once deployed, Railway will give you a URL like: `https://yourapp.up.railway.app`

## Step 6: Test Your API

Your API endpoints will be available at:
- `https://yourapp.up.railway.app/api/auth/register`
- `https://yourapp.up.railway.app/api/auth/login`
- `https://yourapp.up.railway.app/api/auth/profile`

## Step 7: Update CORS (if needed)

If you get CORS errors, Railway's CORS policy in `Program.cs` should handle it, but you may need to update:

```csharp
builder.Services.AddCors(options => { 
    options.AddPolicy("OpenPolicy", builder => { 
        builder.AllowAnyOrigin()
               .AllowAnyMethod()
               .AllowAnyHeader(); 
    }); 
});
```

## Step 8: Update Frontend

In your Netlify site, update your API calls to use the Railway URL:

```javascript
const API_URL = 'https://yourapp.up.railway.app/api';
```

## Troubleshooting

### Build Fails
- Check Railway logs for errors
- Ensure `api.csproj` is in the correct location
- Verify all NuGet packages are specified

### Database Connection Fails
- Double-check environment variables are set correctly
- Verify MySQL connection string format
- Check Railway logs for connection errors

### API Not Responding
- Check Railway logs
- Verify PORT environment variable is set
- Ensure `ASPNETCORE_URLS` includes `http://0.0.0.0:$PORT`

### CORS Errors
- Verify CORS policy in `Program.cs`
- Check that frontend URL is allowed (or use `AllowAnyOrigin`)

## Getting Your Railway URL

1. Go to your Railway project
2. Click on your service
3. Go to "Settings" → "Generate Domain"
4. Copy the URL (format: `yourapp.up.railway.app`)

## Environment Variables Security

**Important**: For production, use Railway's environment variables instead of hardcoding in `appsettings.json`. This keeps your credentials secure.

## Next Steps After Deployment

1. Test registration endpoint: `POST /api/auth/register`
2. Test login endpoint: `POST /api/auth/login`
3. Update your frontend to call Railway API
4. Test full user flow

