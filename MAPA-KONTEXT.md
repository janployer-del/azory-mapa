# Azory Mapa - pracovni kontext

Tato slozka je hlavni pracovni misto pro dalsi upravy mapy Azory 2026.

## Hlavni soubor
- `index.html` je aktualni ziva verze mapy.
- Dalsi upravy mapy delat primarne tady, ne v predchozich prototypech v jinych slozkach.

## Aktualni stav mapy
- Styl mapy: cestovatelsky atlas.
- Logo je vlozene primo do `index.html` jako base64 obrazek, aby sla mapa snadno nahrat na GitHub Pages bez externich assetu.
- Levy panel uz neobsahuje duplicitni obrazek ani blok `Zdroj mapy`.
- Panel zacina statistikami a obsahuje i sekci bodu bez presne polohy.
- Ikony jsou kreslene primo v HTML jako SVG a vizualne navazuji na `D:\Codex\Azory\Ikony\navrh-ikon-azory-2026.png`.

## Data a obsah
- Body mapy jsou ulozene v JS poli `rawPoints` uvnitr `index.html`.
- Offline detail bodu je ulozeny v `data\map-details.js`.
- Lokalni fotky pro mapu jsou ulozene hlavne v `obrazky\flores` a `obrazky\saomiguel`.
- Aktivni Notion zdroj pravdy pro obsah je databaze `Azory - informace` pod strankou `Itinerar`.
- Pro synchronizaci mapy s Notionem pouzivat pole `Aktualizovat na webu`.
- `Turistika` a `Priroda` uz nemaji stejnou ikonu: `Priroda` pouziva list, `Turistika` pohorku.
- `Atrakce` je plnohodnotna mapova kategorie.
- Body bez souradnic zustavaji v levem panelu bez markeru.
- Obecna doprava, parkovani, pocasi a jine provozni checklisty do atlasove mapy nepatri.

## Struktura bodu
- `name`
- `subtitle`
- `rawCoordinates`
- `type`
- `theme`
- `phase`
- `visitDate`
- `visitEnd`
- `reserveBy`
- `mapyUrl`
- `notionUrl`

## Prakticky postup
- Pred kazdou dalsi upravou mapy nejdriv spustit `tools\backup-map.ps1`.
- Zalohy ukladat do slozky `backup` vedle mapy.
- V prvni verzi se automaticky zalohuje jen zivy `index.html`.
- Nejdriv upravit `index.html` v teto slozce.
- Potom mapu otevrit v prohlizeci a overit:
  - marker
  - filtr tematu
  - filtr faze
  - popup
  - rozlozeni leveho panelu
  - sekci neukotvenych bodu

## Synchronizace z Notionu
- Kdyz uzivatel rekne `zapis do mapy nova mista`, brat to jako pokyn synchronizovat vsechny zaznamy z databaze `Azory - informace`, ktere maji `Aktualizovat na webu` = 1.
- Synchronizace znamena nejen pridani novych bodu, ale i aktualizaci uz existujicich bodu na mape, pokud se zmenil text, souradnice, datum, tema, faze, Mapy.cz odkaz nebo fotky.
- Zdroj pravdy je Notion karta konkretniho mista, ne stary text v mape.

## Co pri synchronizaci delat
- 1. Vyhledat v Notionu vsechny zaznamy s `Aktualizovat na webu` = 1.
- 2. Pro kazdy zaznam rozhodnout, jestli uz existuje v `rawPoints` podle `notionUrl`, nebo jde o novy bod.
- 3. V `index.html` zapsat nebo upravit zakladni mapovy zaznam:
  - `name`
  - `subtitle`
  - `rawCoordinates`
  - `type`
  - `theme`
  - `phase`
  - `visitDate`
  - `visitEnd`
  - `reserveBy`
  - `mapyUrl`
  - `notionUrl`
- 4. V `data\map-details.js` zapsat nebo upravit offline detail:
  - `shortDescription`
  - `detailText`
  - `tips`
  - `primaryImage`
  - `images`
- 5. Z Notion stranky stahnout vsechny relevantni inline fotky do lokalni slozky `obrazky\...` pod stabilnimi nazvy.
- 6. Prvni nebo nejvhodnejsi fotku nastavit jako `primaryImage`, ostatni nechat v `images`.
- 7. Pokud zaznam v Notionu fotky nema, nechat v mape placeholder a nelamat UI.

## Pravidla pro lookup a aktualizaci
- Primarni identifikator bodu je Notion `pageId`, ne cela `notionUrl`.
- `pageId` se extrahuje z URL a podle nej se rozhoduje, jestli jde o update existujiciho bodu nebo novy insert.
- Pri update se ma `notionUrl` v mape prepsat na aktualni kanonickou URL vracenou API.
- Pokud je v Notionu novy bod s `Aktualizovat na webu` = 1 a na mape neexistuje, prida se jako plnohodnotny offline bod.
- Pokud ma bod na mape lokalni detail, popup i bocni panel musi zustat napojene na `window.MAP_DETAILS`.

## Fotky a skripty
- Pro stahovani fotek je mozne vytvorit nebo rozsirit jednorazovy PowerShell skript v `tools\`.
- Existujici pomocne skripty:
  - `tools\download-flores-images.ps1`
  - `tools\download-saomiguel-images.ps1`
  - `tools\download-saomiguel-missing-images.ps1`
  - `tools\download-new-notion-points-images.ps1`
  - `tools\fetch-notion-web-sync.mjs`
  - `tools\sync-marked-notion-points.ps1`
- Pro mapu pouzivat jen inline Notion-hosted obrazky primo z obsahu stranky.
- Externi ilustracni obrazky nebo verejne odkazy mimo inline Notion soubory do mapy nestahovat.
- Pokud vznikne nova vlna zmen, je v poradku pridat dalsi specializovany skript nebo upravit existujici, ale vysledek musi skoncit v lokalnich souborech pod `obrazky\...`.

## Primy pristup do Notion API
- Pokud vestaveny Notion konektor v Codexu neumi dotaz nad databazi, pouzit `tools\fetch-notion-web-sync.mjs`.
- Skript cte token z promenne prostredi `NOTION_TOKEN`.
- Dotazuje data source `345351be-095e-816f-9208-000b1bafe958` a filtruje `Aktualizovat na webu = true`.
- Normalizovany vystup uklada do `data\notion-web-sync.json`.

## Co po synchronizaci overit
- Vsechny synchronizovane `notionUrl` existuji v `rawPoints`.
- Vsechny synchronizovane `notionUrl` existuji i v `data\map-details.js`.
- Vsechny obrazky uvedene v `primaryImage` a `images` fyzicky existuji na disku.
- Nove nebo upravene body se zobrazuji ve spravne fazi itinerare.
- Popup ukazuje skutecny nahled, pokud ma bod lokalni fotku.
- Bocni panel ukazuje lokalni detail a `Detailni popis` jako zalozni Notion odkaz.

## Cil
- Udrzovat jednu prehlednou, publikovatelnou verzi mapy bez rozjetych vedlejsich variant.
