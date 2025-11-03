# Render Deployment Guide for CFB Picks API

## Step 1: Create Render Account

1. Go to https://render.com
2. Sign up with GitHub (recommended)
3. Choose the **Free** plan

## Step 2: Create New Web Service

1. In Render dashboard, click **"New +"**
2. Select **"Web Service"**
3. Connect your GitHub repository
4. Select your repository

## Step 3: Configure Build Settings

Render should auto-detect .NET, but verify:

- **Name**: `cfb-picks-api` (or your choice)
- **Environment**: `Docker` or `Node` (but actually use `.NET`)
- **Region**: Choose closest to you
- **Branch**: `main` or `master`
- **Root Directory**: `Client/api` (if your API is in a subfolder)
- **Build Command**: `dotnet build`
- **Start Command**: `dotnet run --project api.csproj --urls http://0.0.0.0:$PORT`

**OR** if Root Directory is just `api`:
- **Build Command**: Leave empty (auto-detects)
- **Start Command**: `dotnet api.dll --urls http://0.0.0.0:$PORT`

## Step 4: Set Environment Variables

Click **"Environment"** tab and add:

```
ConnectionStrings__DefaultConnection=Server=etdq12exrvdjisg6.cbetxkdyhwsb.us-east-1.rds.amazonaws.com;Port=3306;Database=c86v9vfflniegysr;User=x8kicio7cckzkrin;Password=jv3nfhqf64jj44m4;
Jwt__Key=YourSuperSecretKeyThatIsAtLeast32CharactersLong!
Jwt__Issuer=CFBPicks
Jwt__Audience=CFBPicksUsers
Jwt__ExpiryMinutes=1440
ASPNETCORE_ENVIRONMENT=Production
ASPNETCORE_URLS=http://0.0.0.0:$PORT
PORT=10000
```

**Note**: Use double underscores `__` for nested config values.

## Step 5: Deploy

1. Click **"Create Web Service"**
2. Render will build and deploy automatically
3. Wait for deployment (5-10 minutes first time)
4. Your API will be live at: `https://your-app-name.onrender.com`

## Step 6: Test Your API

Test endpoints:
- `https://your-app-name.onrender.com/api/auth/register`
- `https://your-app-name.onrender.com/api/auth/login`

## Important Notes

### Free Tier Limitations:
- **Sleeps after 15 minutes** of inactivity
- First request after sleep takes ~30 seconds (wake up time)
- 750 hours/month free (essentially unlimited for low traffic)

### Keep-Alive (Optional):
To prevent sleep, you can:
1. Use a free service like UptimeRobot to ping your API every 10 minutes
2. Or upgrade to paid tier ($7/month) for always-on

### CORS:
Your CORS settings in `Program.cs` should already allow requests from Netlify.

## Troubleshooting

### Build Fails:
- Check Root Directory is correct
- Verify Start Command uses `$PORT` environment variable
- Check build logs in Render dashboard

### Database Connection Fails:
- Verify environment variables are set correctly
- Check MySQL connection string format
- Ensure Heroku database allows connections from Render's IPs

### API Not Responding:
- Check Render logs for errors
- Verify `PORT` environment variable is set
- Ensure `ASPNETCORE_URLS` includes `http://0.0.0.0:$PORT`

## Getting Your Render URL

1. Go to your service in Render dashboard
2. Click on your service
3. The URL is shown at the top (format: `yourapp.onrender.com`)

## Next Steps

1. Test your deployed API endpoints
2. Update your Netlify site to use Render URL instead of localhost
3. Test full registration/login flow from Netlify



