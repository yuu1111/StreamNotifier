[CmdletBinding()]
param(
	[Parameter(Mandatory)]
	[string]$Package,
	[ValidateRange(1, 100)]
	[int]$Keep = 3,
	[string]$Owner = $env:GITHUB_REPOSITORY_OWNER,
	[string]$ApiUrl = $(if ($env:GITHUB_API_URL) { $env:GITHUB_API_URL } else { "https://api.github.com" }),
	[switch]$DryRun
)

$ErrorActionPreference = "Stop"
$token = $env:GITHUB_TOKEN

if ([string]::IsNullOrWhiteSpace($Owner)) {
	throw "Pass -Owner or set GITHUB_REPOSITORY_OWNER"
}
if ([string]::IsNullOrWhiteSpace($token)) {
	throw "Set GITHUB_TOKEN without passing it on the command line"
}

$headers = @{
	Accept                 = "application/vnd.github+json"
	Authorization          = "Bearer $token"
	"X-GitHub-Api-Version" = "2022-11-28"
	"User-Agent"           = "ghcr-retention"
}
$baseUrl = $ApiUrl.TrimEnd("/")
$escapedOwner = [uri]::EscapeDataString($Owner)
$escapedPackage = [uri]::EscapeDataString($Package)
$ownerInfo = Invoke-RestMethod -Uri "$baseUrl/users/$escapedOwner" -Headers $headers
$ownerSegment = if ($ownerInfo.type -eq "Organization") { "orgs" } else { "users" }
$packagePath = "$ownerSegment/$escapedOwner/packages/container/$escapedPackage"

$versions = [System.Collections.Generic.List[object]]::new()
$page = 1
do {
	$listParams = @{
		Uri     = "$baseUrl/$packagePath/versions?per_page=100&page=$page"
		Headers = $headers
	}
	$batch = Invoke-RestMethod @listParams
	foreach ($version in @($batch)) {
		$versions.Add($version)
	}
	$page++
} while ($batch.Count -eq 100)

$shaTagPattern = '^(?:sha-[0-9a-f]{7,40}|[0-9a-f]{40})$'
$ordered = @($versions | Sort-Object { [datetime]$_.created_at } -Descending)
$generation = 0
$candidates = [System.Collections.Generic.List[object]]::new()
$protected = [System.Collections.Generic.List[object]]::new()

foreach ($version in $ordered) {
	$tags = @($version.metadata.container.tags)
	$isGeneration = @($tags | Where-Object { $_ -match $shaTagPattern }).Count -gt 0
	if ($isGeneration) {
		$generation++
	}

	if ($generation -eq 0 -or $generation -le $Keep) {
		$protected.Add($version)
		continue
	}

	$protectedTags = @(
		$tags | Where-Object {
			$_ -eq "latest" -or $_ -notmatch $shaTagPattern
		}
	)
	if ($protectedTags.Count -gt 0) {
		Write-Warning "Keeping version $($version.id) because it has non-SHA tags: $($protectedTags -join ', ')"
		$protected.Add($version)
		continue
	}
	$candidates.Add($version)
}

if ($generation -lt $Keep) {
	Write-Output "GHCR retention: found $generation tagged generations; keeping all versions"
	exit 0
}

Write-Output "GHCR retention: package=$Owner/$Package generations=$generation keep=$Keep versions=$($versions.Count) delete=$($candidates.Count)"

foreach ($version in $candidates) {
	$tags = @($version.metadata.container.tags)
	$label = if ($tags.Count -gt 0) { $tags -join "," } else { $version.name }
	if ($DryRun) {
		Write-Output "Would delete version: id=$($version.id) value=$label"
		continue
	}

	$deleteParams = @{
		Uri     = "$baseUrl/$packagePath/versions/$($version.id)"
		Headers = $headers
		Method  = "Delete"
	}
	Invoke-RestMethod @deleteParams
	Write-Output "Deleted version: id=$($version.id) value=$label"
}
