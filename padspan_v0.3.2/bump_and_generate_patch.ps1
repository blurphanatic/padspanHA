param(
  [switch]$DryRun,
  [string]$CurrentVersion = ""
)

function Run-Git {
  param([string]$Args)
  $out = & git $Args 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw ("git {0} failed (exit {1}):`n{2}" -f $Args, $LASTEXITCODE, $out)
  }
  return $out
}

# Ensure git available
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Error "git not found on PATH. Install Git and retry."
  exit 1
}

# Try to detect current version if not provided
if ([string]::IsNullOrWhiteSpace($CurrentVersion)) {
  try {
    $tag = Run-Git "describe --tags --abbrev=0" 2>$null
    if ($tag) { $candidate = $tag.Trim() -replace '^[vV]','' } else { $candidate = "" }
  } catch {
    $candidate = ""
  }

  if ($candidate -and ($candidate -match '^[0-9]+\.[0-9]+\.[0-9]+$')) {
    $CurrentVersion = $candidate
  } else {
    # fallback: search tracked files for semver tokens
    $tokens = git ls-files | ForEach-Object {
      try { Select-String -Path $_ -Pattern '\b[0-9]+\.[0-9]+\.[0-9]+\b' -AllMatches -ErrorAction SilentlyContinue } catch { $null }
    } | ForEach-Object { foreach ($m in $_.Matches) { $m.Value } }
    if ($tokens) {
      $CurrentVersion = $tokens | Group-Object | Sort-Object Count -Descending | Select-Object -First 1 -ExpandProperty Name
    }
  }
}

if (-not $CurrentVersion) {
  Write-Error "Could not detect a current semver. Re-run with -CurrentVersion 'MAJOR.MINOR.PATCH' (e.g. -CurrentVersion '1.2.3')."
  exit 1
}

if ($CurrentVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') {
  Write-Error ("Supplied/detected version '{0}' is not semver MAJOR.MINOR.PATCH. Provide a proper version via -CurrentVersion." -f $CurrentVersion)
  exit 1
}

Write-Host ("Using current version: {0}" -f $CurrentVersion)

# Compute new version
$parts = $CurrentVersion.Split('.')
[int]$maj = $parts[0]; [int]$min = $parts[1]; [int]$patch = $parts[2]
$NewVersion = "{0}.{1}.0" -f $maj, ($min + 1)
Write-Host ("New version will be: {0}" -f $NewVersion)

# Branch name
$BranchName = "bump-version-v$NewVersion"
# original branch
$OrigBranch = (& git rev-parse --abbrev-ref HEAD).Trim()

# Create branch
try {
  Run-Git ("checkout -b {0}" -f $BranchName) | Out-Null
} catch {
  Write-Error ("Failed to create branch {0}: {1}" -f $BranchName, $_)
  exit 1
}

# Operate on tracked files only
$tracked = git ls-files
$touched = @()

foreach ($f in $tracked) {
  try {
    $text = Get-Content -Raw -LiteralPath $f -ErrorAction Stop
  } catch {
    continue
  }
  if ($text -match [regex]::Escape($CurrentVersion)) {
    $newText = $text -replace [regex]::Escape($CurrentVersion), $NewVersion
    if ($newText -ne $text) {
      if (-not $DryRun) {
        Set-Content -LiteralPath $f -Value $newText -Encoding UTF8
      }
      $touched += $f
    }
  }
}

if ($touched.Count -eq 0) {
  Write-Host ("No tracked files contained the token '{0}'. Deleting branch and exiting." -f $CurrentVersion)
  Run-Git ("checkout {0}" -f $OrigBranch) | Out-Null
  Run-Git ("branch -D {0}" -f $BranchName) | Out-Null
  exit 0
}

Write-Host ("Files changed: {0}" -f $touched.Count)
$touched | ForEach-Object { Write-Host " - $_" }

if ($DryRun) {
  Write-Host "`nDRY RUN: Showing diffs for up to first 10 changed files..."
  $i = 0
  foreach ($f in $touched) {
    if ($i -ge 10) { Write-Host " ... (diffs truncated)"; break }
    Write-Host "`n--- $f (diff) ---"
    # build temp modified content and use git --no-index diff
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
      $orig = Get-Content -Raw -LiteralPath $f -ErrorAction Stop
      $modified = $orig -replace [regex]::Escape($CurrentVersion), $NewVersion
      Set-Content -LiteralPath $tmp -Value $modified -Encoding UTF8
      try { & git --no-pager diff --no-index -- $f $tmp } catch { }
    } finally {
      Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
    }
    $i++
  }
  # cleanup preview branch
  Run-Git ("checkout {0}" -f $OrigBranch) | Out-Null
  Run-Git ("branch -D {0}" -f $BranchName) | Out-Null
  Write-Host "`nDRY RUN complete. No files were changed."
  exit 0
}

# Commit changes and write patch
Run-Git "add -A"
Run-Git ("commit -m {0}" -f ("chore: bump version to v" + $NewVersion)) | Out-Null

$PatchFile = "bump-version-v$NewVersion.patch"
try {
  Run-Git "format-patch -1 --stdout" | Set-Content -LiteralPath $PatchFile -Encoding UTF8
  Write-Host ("Patch written: {0}" -f $PatchFile)
} catch {
  Write-Warning ("Failed to write patch: {0}" -f $_)
}

Write-Host ("Committed on branch {0}. To push: git push -u origin {0}" -f $BranchName)
Write-Host ("To create and push tag: git tag -a v{0} -m 'Release v{0}'; git push origin v{0}" -f $NewVersion)