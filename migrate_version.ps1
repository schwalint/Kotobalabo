param(
    [string]$From = "C:\Users\franh\Desktop\Pitch Accent\JP Pitch drill\Kotoba Lab\KotobaLabo_v1.9\data",
    [string]$To   = "C:\Users\franh\Desktop\Pitch Accent\JP Pitch drill\Kotoba Lab\KotobaLabo_v2.0\data"
)

New-Item -ItemType Directory -Force -Path $To | Out-Null
Copy-Item -Path "$From\*" -Destination "$To\" -Recurse -Force

Write-Host "Migrated data/ from v1.9 to v2.0 at $To"
