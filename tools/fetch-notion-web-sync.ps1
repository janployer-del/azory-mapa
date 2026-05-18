param(
  [string]$DataSourceId = '345351be-095e-816f-9208-000b1bafe958',
  [string]$OutputPath = 'D:\Codex\Azory\Mapa\data\notion-web-sync.json',
  [string]$NotionVersion = '2025-09-03',
  [switch]$Stdout
)

$ErrorActionPreference = 'Stop'

if (-not $env:NOTION_TOKEN) {
  throw 'Environment variable NOTION_TOKEN is required.'
}

$headers = @{
  'Authorization'  = "Bearer $($env:NOTION_TOKEN)"
  'Notion-Version' = $NotionVersion
  'Content-Type'   = 'application/json'
}

function New-PropertyNames {
  return @{
    Title = ('N' + [char]225 + 'zev')
    Coordinates = ('Sou' + [char]345 + 'adnice')
    Type = ('Typ z' + [char]225 + 'znamu')
    Theme = ('T' + [char]233 + 'ma')
    Phase = ('F' + [char]225 + 'ze cesty')
    VisitDate = ('Den kdy nav' + [char]353 + 't' + [char]237 + 'vit')
    ReserveBy = ('Rezervovat do')
    MapyUrl = ('Odkaz mapy CZ')
    IsNew = ('Nov' + [char]233)
    UpdateOnWeb = ('Aktualizovat na webu')
  }
}

$propertyNames = New-PropertyNames

function Get-PropertyValue {
  param(
    $Page,
    [string]$PropertyName
  )

  if ($null -eq $Page.properties) {
    return $null
  }

  return $Page.properties.$PropertyName
}

function Convert-TitleToText {
  param($Property)

  if ($null -eq $Property -or $null -eq $Property.title) {
    return ''
  }

  return (($Property.title | ForEach-Object { $_.plain_text }) -join '').Trim()
}

function Convert-RichTextToText {
  param($Property)

  if ($null -eq $Property -or $null -eq $Property.rich_text) {
    return ''
  }

  return (($Property.rich_text | ForEach-Object { $_.plain_text }) -join '').Trim()
}

function Convert-SelectToText {
  param($Property)

  if ($null -eq $Property -or $null -eq $Property.select) {
    return ''
  }

  return [string]$Property.select.name
}

function Convert-DateToIso {
  param($Property)

  if ($null -eq $Property -or $null -eq $Property.date) {
    return ''
  }

  return [string]$Property.date.start
}

function Convert-CheckboxToBool {
  param($Property)

  if ($null -eq $Property) {
    return $false
  }

  return [bool]$Property.checkbox
}

function Convert-FormulaToText {
  param($Property)

  if ($null -eq $Property -or $null -eq $Property.formula) {
    return ''
  }

  $formula = $Property.formula

  switch ($formula.type) {
    'string' { return [string]$formula.string }
    'number' {
      if ($null -eq $formula.number) { return '' }
      return [string]$formula.number
    }
    'boolean' {
      if ($formula.boolean) { return 'true' }
      return 'false'
    }
    'date' {
      if ($null -eq $formula.date) { return '' }
      return [string]$formula.date.start
    }
    default { return '' }
  }
}

function Convert-PropertyToText {
  param($Property)

  if ($null -eq $Property) {
    return ''
  }

  switch ($Property.type) {
    'title' { return Convert-TitleToText $Property }
    'rich_text' { return Convert-RichTextToText $Property }
    'url' { return [string]$Property.url }
    'select' { return Convert-SelectToText $Property }
    'date' { return Convert-DateToIso $Property }
    'formula' { return Convert-FormulaToText $Property }
    default { return '' }
  }
}

function Convert-PageToNormalizedItem {
  param($Page)

  $item = [ordered]@{
    title = Convert-TitleToText (Get-PropertyValue $Page $propertyNames.Title)
    url = [string]$Page.url
    notionUrl = [string]$Page.url
  }

  $item[$propertyNames.Coordinates] = Convert-PropertyToText (Get-PropertyValue $Page $propertyNames.Coordinates)
  $item[$propertyNames.Type] = Convert-SelectToText (Get-PropertyValue $Page $propertyNames.Type)
  $item[$propertyNames.Theme] = Convert-SelectToText (Get-PropertyValue $Page $propertyNames.Theme)
  $item[$propertyNames.Phase] = Convert-SelectToText (Get-PropertyValue $Page $propertyNames.Phase)
  $item[$propertyNames.VisitDate] = Convert-DateToIso (Get-PropertyValue $Page $propertyNames.VisitDate)
  $item[$propertyNames.ReserveBy] = Convert-DateToIso (Get-PropertyValue $Page $propertyNames.ReserveBy)
  $item[$propertyNames.MapyUrl] = Convert-PropertyToText (Get-PropertyValue $Page $propertyNames.MapyUrl)
  $item[$propertyNames.IsNew] = Convert-CheckboxToBool (Get-PropertyValue $Page $propertyNames.IsNew)
  $item[$propertyNames.UpdateOnWeb] = Convert-CheckboxToBool (Get-PropertyValue $Page $propertyNames.UpdateOnWeb)
  $item['lastEditedTime'] = [string]$Page.last_edited_time
  $item['createdTime'] = [string]$Page.created_time

  return $item
}

$allPages = New-Object System.Collections.Generic.List[object]
$nextCursor = $null

do {
  $body = @{
    page_size = 100
    filter = @{
      property = $propertyNames.UpdateOnWeb
      checkbox = @{
        equals = $true
      }
    }
    sorts = @(
      @{
        timestamp = 'last_edited_time'
        direction = 'descending'
      }
    )
  }

  if ($nextCursor) {
    $body.start_cursor = $nextCursor
  }

  $response = Invoke-RestMethod `
    -Method Post `
    -Uri "https://api.notion.com/v1/data_sources/$DataSourceId/query" `
    -Headers $headers `
    -Body ($body | ConvertTo-Json -Depth 10)

  foreach ($result in $response.results) {
    $allPages.Add($result)
  }

  if ($response.has_more) {
    $nextCursor = $response.next_cursor
  } else {
    $nextCursor = $null
  }
} while ($nextCursor)

$items = foreach ($page in $allPages) {
  Convert-PageToNormalizedItem $page
}

$payload = [ordered]@{
  generatedAt = [DateTime]::UtcNow.ToString('o')
  source = [ordered]@{
    dataSourceId = $DataSourceId
    notionVersion = $NotionVersion
    filter = [ordered]@{
      property = $propertyNames.UpdateOnWeb
      checkboxEquals = $true
    }
  }
  count = $items.Count
  items = $items
}

$json = $payload | ConvertTo-Json -Depth 10

if (-not $Stdout) {
  $outputDirectory = Split-Path -Parent $OutputPath
  if (-not (Test-Path -LiteralPath $outputDirectory)) {
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
  }

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($OutputPath, $json, $utf8NoBom)
  Write-Host "Saved $($items.Count) items to $OutputPath"
}

$json
