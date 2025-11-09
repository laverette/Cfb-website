# Use the official .NET 8 runtime as the base image
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
WORKDIR /app
# Expose port (will be overridden by Render's PORT env var)
EXPOSE 10000
# Don't set ASPNETCORE_URLS here - let Render's environment variable handle it

# Use the .NET 8 SDK to build the application
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
ARG BUILD_CONFIGURATION=Release
WORKDIR /src

# Copy the project file first (for better caching)
COPY ["Client/api/api.csproj", "Client/api/"]
RUN dotnet restore "Client/api/api.csproj"

# Copy the rest of the source code
COPY . .

WORKDIR "/src/Client/api"
RUN dotnet build "api.csproj" -c $BUILD_CONFIGURATION -o /app/build

# Publish the application
FROM build AS publish
ARG BUILD_CONFIGURATION=Release
WORKDIR "/src/Client/api"
RUN dotnet publish "api.csproj" -c $BUILD_CONFIGURATION -o /app/publish /p:UseAppHost=false

# Create the final runtime image
FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "api.dll"]
