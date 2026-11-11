$ErrorActionPreference = 'Stop'

$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$rootPrefix = $root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$port = 8766
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$port/")

$contentTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.css' = 'text/css; charset=utf-8'
    '.js' = 'text/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.webmanifest' = 'application/manifest+json; charset=utf-8'
}

try {
    $listener.Start()
} catch {
    Write-Host "Could not start the local test server on port $port." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host 'If this port is already in use, close that test server and try again.'
    Read-Host 'Press Enter to close'
    exit 1
}

Write-Host 'StitchSketch FLUX.2 test server is running.' -ForegroundColor Green
Write-Host "Open Chrome at http://127.0.0.1:$port/"
Write-Host 'The local server serves only these app files. Press Ctrl+C here to stop it.'

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $response = $context.Response
        try {
            if ($context.Request.HttpMethod -ne 'GET' -and $context.Request.HttpMethod -ne 'HEAD') {
                $response.StatusCode = 405
                $response.Close()
                continue
            }

            $relativePath = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
            if ([string]::IsNullOrWhiteSpace($relativePath)) { $relativePath = 'index.html' }
            $relativePath = $relativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
            $filePath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $relativePath))
            if (-not $filePath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                $response.StatusCode = 403
                $response.Close()
                continue
            }
            if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
                $response.StatusCode = 404
                $response.Close()
                continue
            }

            $extension = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
            if ($contentTypes.ContainsKey($extension)) { $response.ContentType = $contentTypes[$extension] }
            else { $response.ContentType = 'application/octet-stream' }
            $response.Headers['X-Content-Type-Options'] = 'nosniff'
            if ($context.Request.HttpMethod -eq 'HEAD') {
                $response.ContentLength64 = (Get-Item -LiteralPath $filePath).Length
                $response.StatusCode = 200
                $response.Close()
                continue
            }
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $bytes.Length
            $response.StatusCode = 200
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.Close()
        } catch {
            try { $response.StatusCode = 500; $response.Close() } catch { }
            Write-Host "Request error: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
} finally {
    if ($listener.IsListening) { $listener.Stop() }
    $listener.Close()
}
