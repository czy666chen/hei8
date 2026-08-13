param(
  [Parameter(Mandatory = $true)][string]$BaseUrl,
  [Parameter(Mandatory = $true)][string]$InviteCode
)

$ErrorActionPreference = "Stop"

function Invoke-Api {
  param(
    [string]$Path,
    [string]$Method = "GET",
    [object]$Body = $null,
    [Microsoft.PowerShell.Commands.WebRequestSession]$Session
  )
  $parameters = @{
    Uri = "$BaseUrl$Path"
    Method = $Method
    UseBasicParsing = $true
    TimeoutSec = 30
    WebSession = $Session
  }
  if ($null -ne $Body) {
    $parameters.ContentType = "application/json"
    $parameters.Headers = @{ Origin = $BaseUrl }
    $parameters.Body = $Body | ConvertTo-Json -Depth 30 -Compress
  }
  try {
    $response = Invoke-WebRequest @parameters
    return [PSCustomObject]@{ Status = [int]$response.StatusCode; Data = $response.Content | ConvertFrom-Json }
  } catch [System.Net.WebException] {
    $response = $_.Exception.Response
    if ($null -eq $response) { throw }
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
    try { $content = $reader.ReadToEnd() } finally { $reader.Dispose() }
    $data = if ($content) { $content | ConvertFrom-Json } else { [PSCustomObject]@{} }
    return [PSCustomObject]@{ Status = [int]$response.StatusCode; Data = $data }
  }
}

function Assert-Status([object]$Result, [int]$Expected, [string]$Label) {
  if ($Result.Status -ne $Expected) {
    throw "$Label expected $Expected, received $($Result.Status): $($Result.Data | ConvertTo-Json -Compress)"
  }
}

function Get-Sha256([string]$Value) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $hash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)) } finally { $sha.Dispose() }
  return ($hash | ForEach-Object { $_.ToString("x2") }) -join ""
}

function Register-SmokeAccount([string]$Username, [Microsoft.PowerShell.Commands.WebRequestSession]$Session) {
  $result = Invoke-Api -Path "/api/auth/register" -Method POST -Session $Session -Body @{
    username = $Username
    password = "Smoke-$([guid]::NewGuid())"
    inviteCode = $InviteCode
  }
  Assert-Status $result 201 "register $Username"
  return $result.Data.user.id
}

$suffix = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString("x")
$sessionA = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$sessionB = New-Object Microsoft.PowerShell.Commands.WebRequestSession

$health = Invoke-Api -Path "/api/health" -Session $sessionA
Assert-Status $health 200 "health"
if ($health.Data.status -ne "ok" -or $health.Data.database -ne "ok") { throw "health did not confirm D1" }

$invalid = Invoke-Api -Path "/api/auth/register" -Method POST -Session $sessionA -Body @{
  username = "bad_$($suffix.Substring([Math]::Max(0, $suffix.Length - 8)))"
  password = "Smoke-invalid-1"
  inviteCode = "definitely-invalid"
}
Assert-Status $invalid 403 "invalid invite"

$shortSuffix = $suffix.Substring([Math]::Max(0, $suffix.Length - 8))
$userA = Register-SmokeAccount "smokea_$shortSuffix" $sessionA
$userB = Register-SmokeAccount "smokeb_$shortSuffix" $sessionB
Assert-Status (Invoke-Api -Path "/api/auth/me" -Session $sessionA) 200 "authenticated session"

$device = Invoke-Api -Path "/api/devices" -Method POST -Session $sessionA -Body @{ deviceKey = "smoke-$suffix"; name = "Preview smoke device" }
Assert-Status $device 201 "register device"

$snapshotJson = @{ id = "preset-$suffix"; name = "Preview smoke preset"; rules = @(@{ id = "win"; value = 4 }) } | ConvertTo-Json -Depth 10 -Compress
$migration = @{
  batchId = Get-Sha256 "batch-$suffix"
  deviceId = $device.Data.device.id
  item = @{
    kind = "preset"
    localId = "preset-$suffix"
    resourceId = [guid]::NewGuid().ToString()
    operationId = [guid]::NewGuid().ToString()
    snapshotJson = $snapshotJson
    checksum = Get-Sha256 $snapshotJson
  }
}
$imported = Invoke-Api -Path "/api/migrations/local" -Method POST -Session $sessionA -Body $migration
Assert-Status $imported 201 "migration import"
$duplicate = Invoke-Api -Path "/api/migrations/local" -Method POST -Session $sessionA -Body $migration
Assert-Status $duplicate 200 "migration retry"
if ($duplicate.Data.result -ne "duplicate" -or $duplicate.Data.resourceId -ne $imported.Data.resourceId) { throw "migration retry was not idempotent" }

Assert-Status (Invoke-Api -Path "/api/presets/$($imported.Data.resourceId)" -Session $sessionA) 200 "owner reads preset"
Assert-Status (Invoke-Api -Path "/api/presets/$($imported.Data.resourceId)" -Session $sessionB) 404 "other account reads preset"

$match = Invoke-Api -Path "/api/matches" -Method POST -Session $sessionA -Body @{
  operationId = [guid]::NewGuid().ToString()
  deviceId = $device.Data.device.id
  mode = "score"
}
Assert-Status $match 201 "create match"
Assert-Status (Invoke-Api -Path "/api/matches/$($match.Data.match.id)" -Session $sessionA) 200 "owner reads match"
Assert-Status (Invoke-Api -Path "/api/matches/$($match.Data.match.id)" -Session $sessionB) 404 "other account reads match"

Assert-Status (Invoke-Api -Path "/api/auth/logout" -Method POST -Session $sessionA -Body @{}) 200 "logout"
$afterLogout = Invoke-Api -Path "/api/auth/me" -Session $sessionA
Assert-Status $afterLogout 200 "session after logout"
if ($afterLogout.Data.session.authenticated -ne $false) { throw "logged out session remained authenticated" }

[PSCustomObject]@{
  health = "ok"
  invalidInvite = "blocked"
  migration = "accepted + duplicate"
  authorization = "A/B isolation passed"
  logout = "passed"
  cleanupUserIds = @($userA, $userB)
} | ConvertTo-Json -Compress
