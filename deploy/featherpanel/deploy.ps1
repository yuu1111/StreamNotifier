[CmdletBinding()]
param(
	[string]$PanelEnvFile = $env:FEATHERPANEL_ENV_FILE,
	[int]$NodeId = 0,
	[string]$AllocationIp = "",
	[int]$AllocationPort = 0,
	[int]$OwnerId = 0
)

$ErrorActionPreference = "Stop"

function Read-DotEnv([string]$Path) {
	if (-not (Test-Path -LiteralPath $Path)) {
		throw "Environment file was not found: $Path"
	}
	$values = @{}
	foreach ($line in Get-Content -LiteralPath $Path) {
		if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
			$values[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
		}
	}
	return $values
}

if ([string]::IsNullOrWhiteSpace($PanelEnvFile)) {
	throw "Pass -PanelEnvFile or set FEATHERPANEL_ENV_FILE"
}

$panel = Read-DotEnv $PanelEnvFile
foreach ($name in @("FEATHERPANEL_URL", "FEATHERPANEL_API_PUBLIC_KEY")) {
	if ([string]::IsNullOrWhiteSpace($panel[$name])) {
		throw "$name is missing"
	}
}

$baseUrl = $panel.FEATHERPANEL_URL.TrimEnd("/")
$headers = @{
	Authorization = "Bearer $($panel.FEATHERPANEL_API_PUBLIC_KEY)"
	Accept        = "application/json"
}

function Invoke-PanelApi([string]$Method, [string]$Path, $Body = $null) {
	$params = @{
		Uri     = "$baseUrl$Path"
		Headers = $headers
		Method  = $Method
	}
	if ($null -ne $Body) {
		$params.Body = $Body | ConvertTo-Json -Depth 20 -Compress
		$params.ContentType = "application/json"
	}
	return Invoke-RestMethod @params
}

$session = Invoke-PanelApi GET "/api/user/session"
Write-Output "FeatherPanel session: OK"

$nodes = @((Invoke-PanelApi GET "/api/admin/nodes").data.nodes)
$resolvedNodeId = if ($NodeId -gt 0) {
	$NodeId
} elseif ($panel.FEATHERPANEL_NODE_ID) {
	[int]$panel.FEATHERPANEL_NODE_ID
} elseif ($nodes.Count -eq 1) {
	[int]$nodes[0].id
} else {
	throw "Specify -NodeId because the Panel has $($nodes.Count) nodes"
}
$node = $nodes | Where-Object id -eq $resolvedNodeId | Select-Object -First 1
if (-not $node) {
	throw "Node $resolvedNodeId was not found"
}

$resolvedOwnerId = if ($OwnerId -gt 0) {
	$OwnerId
} elseif ($panel.FEATHERPANEL_OWNER_ID) {
	[int]$panel.FEATHERPANEL_OWNER_ID
} else {
	[int]$session.data.user_info.id
}
$resolvedAllocationIp = if ($AllocationIp) {
	$AllocationIp
} elseif ($panel.FEATHERPANEL_ALLOCATION_IP) {
	$panel.FEATHERPANEL_ALLOCATION_IP
} else {
	$node.public_ip_v4
}

$servers = @((Invoke-PanelApi GET "/api/admin/servers").data.servers)
$server = $servers | Where-Object name -eq "stream-notifier" | Select-Object -First 1
if ($server) {
	Write-Output "Server already exists: id=$($server.id), uuidShort=$($server.uuidShort)"
	exit 0
}

$realms = @((Invoke-PanelApi GET "/api/admin/realms").data.realms)
$realm = $realms | Where-Object name -eq "Discord Bots" | Select-Object -First 1
if (-not $realm) {
	throw "Discord Bots realm was not found"
}
Write-Output "Realm reused: id=$($realm.id)"

$spells = @((Invoke-PanelApi GET "/api/admin/spells?realm_id=$($realm.id)").data.spells)
$spell = $spells | Where-Object name -eq "Stream Notifier" | Select-Object -First 1
if (-not $spell) {
	$spellPath = Join-Path $PSScriptRoot "stream-notifier-spell.json"
	$import = Invoke-RestMethod `
		-Uri "$baseUrl/api/admin/spells/import" `
		-Headers $headers `
		-Method POST `
		-Form @{ realm_id = "$($realm.id)"; file = Get-Item -LiteralPath $spellPath }
	$spell = $import.data.spell
	Write-Output "Spell imported: id=$($spell.id)"
} else {
	Write-Output "Spell reused: id=$($spell.id)"
}

$allocations = @((Invoke-PanelApi GET "/api/admin/allocations?node_id=$resolvedNodeId&limit=100").data.allocations)
$resolvedAllocationPort = if ($AllocationPort -gt 0) {
	$AllocationPort
} elseif ($panel.FEATHERPANEL_ALLOCATION_PORT) {
	[int]$panel.FEATHERPANEL_ALLOCATION_PORT
} else {
	([int]($allocations.port | Measure-Object -Maximum).Maximum) + 1
}
$allocation = $allocations | Where-Object port -eq $resolvedAllocationPort | Select-Object -First 1
if ($allocation -and $allocation.server_id) {
	throw "Allocation port $resolvedAllocationPort is already assigned"
}
if (-not $allocation) {
	$allocationBody = @{
		node_id = $resolvedNodeId
		ip       = $resolvedAllocationIp
		port     = $resolvedAllocationPort
		notes    = "stream-notifier allocation; no listener"
	}
	if ($panel.FEATHERPANEL_ALLOCATION_ALIAS) {
		$allocationBody.ip_alias = $panel.FEATHERPANEL_ALLOCATION_ALIAS
	}
	$allocation = (Invoke-PanelApi PUT "/api/admin/allocations" $allocationBody).data.allocations[0]
	Write-Output "Allocation created: id=$($allocation.id), port=$($allocation.port)"
}

$serverResponse = Invoke-PanelApi PUT "/api/admin/servers" @{
	node_id          = $resolvedNodeId
	name             = "stream-notifier"
	description      = "Twitch stream status monitor and Discord webhook notifier"
	owner_id         = $resolvedOwnerId
	memory           = 256
	swap             = 0
	disk             = 1024
	io               = 500
	cpu              = 50
	allocation_id    = $allocation.id
	realms_id        = $realm.id
	spell_id         = $spell.id
	startup          = "/opt/stream-notifier/stream-notifier"
	image            = "ghcr.io/yuu1111/streamnotifier:latest"
	database_limit   = 0
	allocation_limit = 1
	backup_limit     = 1
	skip_scripts     = $true
	variables        = @{}
	oom_killer       = $true
	threads          = $null
}

$server = $serverResponse.data.server
if (-not $server) {
	$server = @((Invoke-PanelApi GET "/api/admin/servers").data.servers) |
		Where-Object name -eq "stream-notifier" |
		Select-Object -First 1
}
if (-not $server) {
	throw "Server creation returned no server"
}

Write-Output "Server created: id=$($server.id), uuidShort=$($server.uuidShort)"
Write-Output "Server intentionally left stopped. Upload config.json and state data before first start."
