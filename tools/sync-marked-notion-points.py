#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


NOTION_VERSION = "2025-09-03"
DATA_SOURCE_ID = "345351be-095e-816f-9208-000b1bafe958"

MAP_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = MAP_ROOT / "data"
INDEX_PATH = MAP_ROOT / "index.html"
MAP_DETAILS_PATH = DATA_DIR / "map-details.js"
FLORES_DETAILS_PATH = DATA_DIR / "flores-details.js"
SYNC_JSON_PATH = DATA_DIR / "notion-web-sync.json"
DETAIL_CACHE_PATH = DATA_DIR / "notion-web-sync-details.json"


PROPERTY_ALIASES = {
    "coordinates": ["Sou\u0159adnice", "SouĹ™adnice", "SouÄąâ„˘adnice"],
    "entry_type": ["Typ z\u00e1znamu", "Typ zĂˇznamu", "Typ zÄ‚Ë‡znamu"],
    "theme": ["T\u00e9ma", "TĂ©ma", "TÄ‚Â©ma"],
    "phase": ["F\u00e1ze cesty", "FĂˇze cesty", "FÄ‚Ë‡ze cesty"],
    "visit_date": ["Den kdy nav\u0161t\u00edvit", "Den kdy navĹˇtĂ­vit", "Den kdy navÄąË‡tÄ‚Â­vit"],
    "reserve_by": ["Rezervovat do"],
    "mapy_url": ["Odkaz mapy CZ"],
    "is_new": ["Nov\u00e9", "NovĂ©", "NovÄ‚Â©"],
    "sync_flag": ["Aktualizovat na webu"],
}


def strip_accents(value: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFKD", value) if not unicodedata.combining(ch))


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def normalize_for_compare(value: str) -> str:
    return strip_accents(normalize_text(value)).lower()


def slugify(value: str) -> str:
    value = strip_accents(value).lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "notion-item"


def extract_page_id(url: str) -> str:
    if not url:
        return ""
    match = re.search(r"([0-9a-fA-F]{32})$", re.sub(r"[-_]", "", url))
    return match.group(1).lower() if match else ""


def js_escape(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "")
    )


def request_json(method: str, url: str, token: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    attempts = 5
    for attempt in range(1, attempts + 1):
        data = None
        headers = {
            "Authorization": f"Bearer {token}",
            "Notion-Version": NOTION_VERSION,
            "Accept": "application/json",
        }
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = Request(url=url, method=method, headers=headers, data=data)
        try:
            with urlopen(req) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            if exc.code not in {429, 502, 503, 504} or attempt == attempts:
                raise
            retry_after = exc.headers.get("Retry-After")
            delay = float(retry_after) if retry_after else min(2 ** (attempt - 1), 12)
            time.sleep(delay)
        except URLError:
            if attempt == attempts:
                raise
            time.sleep(min(2 ** (attempt - 1), 12))
    raise RuntimeError(f"Notion request failed after {attempts} attempts: {url}")


def first_present(source: dict[str, Any], alias_group: list[str]) -> Any:
    for alias in alias_group:
        if alias in source:
            return source[alias]
    return None


def normalize_property_value(prop: dict[str, Any]) -> Any:
    prop_type = prop.get("type")
    if prop_type == "title":
        return normalize_text("".join(part.get("plain_text", "") for part in prop.get("title", [])))
    if prop_type == "rich_text":
        return normalize_text("".join(part.get("plain_text", "") for part in prop.get("rich_text", [])))
    if prop_type == "select":
        selected = prop.get("select")
        return (selected or {}).get("name", "") if selected else ""
    if prop_type == "multi_select":
        return ", ".join(item.get("name", "") for item in prop.get("multi_select", []) if item.get("name"))
    if prop_type == "date":
        value = prop.get("date")
        return (value or {}).get("start", "") if value else ""
    if prop_type == "checkbox":
        return bool(prop.get("checkbox"))
    if prop_type == "url":
        return prop.get("url", "") or ""
    if prop_type == "number":
        number = prop.get("number")
        return "" if number is None else str(number)
    if prop_type == "status":
        status = prop.get("status")
        return (status or {}).get("name", "") if status else ""
    if prop_type == "formula":
        formula = prop.get("formula") or {}
        if formula.get("type") == "string":
            return formula.get("string", "") or ""
        if formula.get("type") == "number":
            value = formula.get("number")
            return "" if value is None else str(value)
        if formula.get("type") == "boolean":
            return bool(formula.get("boolean"))
    return ""


def normalize_query_result(page: dict[str, Any]) -> dict[str, Any]:
    properties = page.get("properties", {})
    normalized_props = {name: normalize_property_value(value) for name, value in properties.items()}
    entry_type = first_present(normalized_props, PROPERTY_ALIASES["entry_type"]) or ""
    theme = first_present(normalized_props, PROPERTY_ALIASES["theme"]) or ""
    phase = first_present(normalized_props, PROPERTY_ALIASES["phase"]) or ""
    visit_date = first_present(normalized_props, PROPERTY_ALIASES["visit_date"]) or ""
    reserve_by = first_present(normalized_props, PROPERTY_ALIASES["reserve_by"]) or ""
    coordinates = first_present(normalized_props, PROPERTY_ALIASES["coordinates"]) or ""
    mapy_url = first_present(normalized_props, PROPERTY_ALIASES["mapy_url"]) or ""
    is_new = bool(first_present(normalized_props, PROPERTY_ALIASES["is_new"]))
    sync_flag = bool(first_present(normalized_props, PROPERTY_ALIASES["sync_flag"]))
    title = ""
    for name, value in normalized_props.items():
        if value and isinstance(properties.get(name), dict) and properties[name].get("type") == "title":
            title = str(value)
            break
    notion_url = page.get("url", "")
    return {
        "pageId": extract_page_id(notion_url),
        "title": title,
        "url": notion_url,
        "notionUrl": notion_url,
        "coordinates": coordinates,
        "entryType": entry_type,
        "theme": theme,
        "phase": phase,
        "visitDate": visit_date,
        "reserveBy": reserve_by,
        "mapyUrl": mapy_url,
        "isNew": is_new,
        "syncFlag": sync_flag,
        "lastEditedTime": page.get("last_edited_time", ""),
        "createdTime": page.get("created_time", ""),
    }


def query_marked_items(token: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    has_more = True
    start_cursor: str | None = None
    while has_more:
        payload: dict[str, Any] = {
            "page_size": 100,
            "filter": {
                "property": "Aktualizovat na webu",
                "checkbox": {"equals": True},
            },
        }
        if start_cursor:
            payload["start_cursor"] = start_cursor
        response = request_json(
            "POST",
            f"https://api.notion.com/v1/data_sources/{DATA_SOURCE_ID}/query",
            token,
            payload,
        )
        items.extend(normalize_query_result(page) for page in response.get("results", []))
        has_more = bool(response.get("has_more"))
        start_cursor = response.get("next_cursor")
    items.sort(key=lambda item: (item.get("phase", ""), item.get("visitDate", ""), item.get("title", "")))
    return items


def fetch_block_children(token: str, block_id: str) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    has_more = True
    start_cursor: str | None = None
    while has_more:
        url = f"https://api.notion.com/v1/blocks/{block_id}/children?page_size=100"
        if start_cursor:
            url += f"&start_cursor={start_cursor}"
        response = request_json("GET", url, token)
        blocks.extend(response.get("results", []))
        has_more = bool(response.get("has_more"))
        start_cursor = response.get("next_cursor")
    return blocks


def rich_text_to_plain_text(block: dict[str, Any]) -> str:
    payload = block.get(block.get("type", ""), {})
    rich_text = payload.get("rich_text", [])
    return normalize_text("".join(part.get("plain_text", "") for part in rich_text))


def flatten_blocks(token: str, block_id: str) -> list[dict[str, Any]]:
    flat: list[dict[str, Any]] = []
    for block in fetch_block_children(token, block_id):
        block_type = block.get("type", "")
        record: dict[str, Any] = {"type": block_type}
        if block_type in {
            "paragraph",
            "heading_1",
            "heading_2",
            "heading_3",
            "bulleted_list_item",
            "numbered_list_item",
            "quote",
            "callout",
            "to_do",
            "toggle",
        }:
            record["text"] = rich_text_to_plain_text(block)
        elif block_type == "image":
            image = block.get("image", {})
            record["imageType"] = image.get("type")
            if image.get("type") == "file":
                record["imageUrl"] = ((image.get("file") or {}).get("url")) or ""
            elif image.get("type") == "external":
                record["imageUrl"] = ((image.get("external") or {}).get("url")) or ""
        elif block_type == "bookmark":
            record["text"] = normalize_text((block.get("bookmark") or {}).get("url", ""))
        elif block_type == "link_preview":
            record["text"] = normalize_text((block.get("link_preview") or {}).get("url", ""))
        elif block_type == "file":
            file_payload = block.get("file", {})
            record["imageType"] = file_payload.get("type")
            if file_payload.get("type") == "file":
                record["imageUrl"] = ((file_payload.get("file") or {}).get("url")) or ""
        flat.append(record)
        if block.get("has_children"):
            flat.extend(flatten_blocks(token, block.get("id", "")))
    return flat


SECTION_DESCRIPTION = {
    "popis",
    "popis mista",
    "popis místa",
    "o miste",
    "o místě",
}

SECTION_TIPS = {
    "prakticke informace",
    "praktické informace",
    "prakticke poznamky",
    "praktické poznámky",
    "prakticke tipy",
    "praktické tipy",
}

SECTION_MEDIA = {
    "fotografie",
    "foto",
    "gallery",
}


def summarize_page_content(title: str, blocks: list[dict[str, Any]]) -> dict[str, Any]:
    normalized_title = normalize_for_compare(title)
    section = "intro"
    intro_texts: list[str] = []
    description_parts: list[str] = []
    tips: list[str] = []
    inline_images: list[str] = []

    for block in blocks:
        block_type = block.get("type", "")
        if block_type in {"image", "file"}:
            image_url = normalize_text(str(block.get("imageUrl", "")))
            image_type = normalize_text(str(block.get("imageType", "")))
            if image_type == "file" and "prod-files-secure.s3." in image_url:
                inline_images.append(image_url)
            continue

        text = normalize_text(str(block.get("text", "")))
        if not text:
            continue

        normalized = normalize_for_compare(text).strip(":")
        if normalized in SECTION_DESCRIPTION:
            section = "description"
            continue
        if normalized in SECTION_TIPS:
            section = "tips"
            continue
        if normalized in SECTION_MEDIA:
            section = "media"
            continue

        if normalized == normalized_title:
            continue

        if section == "intro":
            intro_texts.append(text)
            continue
        if section == "description":
            description_parts.append(text)
            continue
        if section == "tips":
            if block_type in {"bulleted_list_item", "numbered_list_item"}:
                tips.append(text)
            else:
                parts = [part.strip(" -–—•") for part in re.split(r"[\n;]+", text) if part.strip(" -–—•")]
                if parts:
                    tips.extend(parts)
            continue

    short_description = next((text for text in intro_texts if len(text) >= 24), "")
    if not short_description:
        short_description = next((text for text in description_parts if len(text) >= 24), "")

    if not description_parts and intro_texts:
        description_parts = [text for text in intro_texts if text != short_description]

    if not tips and intro_texts:
        for text in intro_texts[1:]:
            if len(tips) >= 3:
                break
            if text != short_description and len(text) >= 16:
                tips.append(text)

    detail_text = "\n\n".join(part for part in description_parts if part and part != short_description)
    detail_text = detail_text or short_description

    deduped_tips: list[str] = []
    seen = set()
    for tip in tips:
        normalized_tip = normalize_for_compare(tip)
        if normalized_tip and normalized_tip not in seen and tip != short_description:
            seen.add(normalized_tip)
            deduped_tips.append(tip)

    return {
        "shortDescription": short_description,
        "detailText": detail_text,
        "tips": deduped_tips[:6],
        "imageUrls": inline_images,
    }


def choose_type_and_theme(item: dict[str, Any], short_description: str) -> tuple[str, str]:
    entry_type = normalize_text(str(item.get("entryType", "")))
    theme = normalize_text(str(item.get("theme", "")))
    haystack = normalize_for_compare(" ".join([item.get("title", ""), short_description]))

    if not entry_type:
        if "ubytov" in haystack or "apartment" in haystack or "house" in haystack or "camp" in haystack:
            entry_type = "Ubytov\u00e1n\u00ed"
        else:
            entry_type = "Aktivita"

    if not theme:
        if "trek" in haystack or "pr" in haystack or "hike" in haystack or "tura" in haystack:
            theme = "Turistika"
        elif "museum" in haystack or "museu" in haystack or "kaple" in haystack or "histor" in haystack:
            theme = "Atrakce"
        elif "termal" in haystack or "koupan" in haystack or "piscin" in haystack:
            theme = "Koup\u00e1n\u00ed"
        else:
            theme = "Atrakce"

    return entry_type, theme


def make_subtitle(short_description: str) -> str:
    cleaned = normalize_text(short_description.rstrip("."))
    if not cleaned:
        return ""
    subtitle = re.split(r"[.;]", cleaned)[0].strip()
    if len(subtitle) > 78:
        subtitle = subtitle[:75].rstrip(" ,") + "..."
    return subtitle


def image_extension_from_response(headers: Any, url: str) -> str:
    content_type = headers.get("Content-Type", "")
    if "jpeg" in content_type or "jpg" in content_type:
        return ".jpg"
    if "png" in content_type:
        return ".png"
    if "webp" in content_type:
        return ".webp"
    path = urlparse(url).path.lower()
    match = re.search(r"\.(png|jpg|jpeg|webp)$", path)
    if match:
        ext = match.group(1)
        return ".jpg" if ext == "jpeg" else f".{ext}"
    return ".png"


def phase_bucket(phase: str) -> str:
    return "flores" if "flores" in normalize_for_compare(phase) else "saomiguel"


def download_images(image_urls: list[str], title: str, phase: str, skip_downloads: bool) -> list[str]:
    bucket = phase_bucket(phase)
    image_dir = MAP_ROOT / "obrazky" / bucket
    image_dir.mkdir(parents=True, exist_ok=True)
    slug = slugify(title)
    local_paths: list[str] = []

    for index, image_url in enumerate(image_urls, start=1):
        ext = ".png"
        local_file = image_dir / f"{slug}-{index}{ext}"
        if not skip_downloads:
            req = Request(image_url, headers={"Accept": "*/*"})
            with urlopen(req) as response:
                ext = image_extension_from_response(response.headers, image_url)
                local_file = image_dir / f"{slug}-{index}{ext}"
                local_file.write_bytes(response.read())
        local_paths.append(str(local_file.relative_to(MAP_ROOT)).replace("\\", "/"))

    return local_paths


@dataclass
class PointRecord:
    data: dict[str, str]
    raw: str
    notion_url: str
    page_id: str


def scan_js_object_literals(body: str) -> list[tuple[int, int, str]]:
    entries: list[tuple[int, int, str]] = []
    index = 0
    length = len(body)
    while index < length:
        if body[index] != "{":
            index += 1
            continue
        start = index
        depth = 0
        in_string = False
        escape = False
        while index < length:
            char = body[index]
            if in_string:
                if escape:
                    escape = False
                elif char == "\\":
                    escape = True
                elif char == '"':
                    in_string = False
            else:
                if char == '"':
                    in_string = True
                elif char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
                    if depth == 0:
                        end = index + 1
                        entries.append((start, end, body[start:end]))
                        break
            index += 1
        index += 1
    return entries


def scan_top_level_detail_entries(body: str) -> list[tuple[str, str]]:
    entries: list[tuple[str, str]] = []
    index = 0
    length = len(body)
    while index < length:
        quote_start = body.find('"', index)
        if quote_start < 0:
            break
        key_match = re.match(r'"([^"]+)":\s*\{', body[quote_start:])
        if not key_match:
            index = quote_start + 1
            continue
        key = key_match.group(1)
        object_start = quote_start + key_match.group(0).rfind("{")
        cursor = object_start
        depth = 0
        in_string = False
        escape = False
        while cursor < length:
            char = body[cursor]
            if in_string:
                if escape:
                    escape = False
                elif char == "\\":
                    escape = True
                elif char == '"':
                    in_string = False
            else:
                if char == '"':
                    in_string = True
                elif char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
                    if depth == 0:
                        entry_end = cursor + 1
                        entries.append((key, body[quote_start:entry_end].strip().rstrip(",")))
                        index = entry_end
                        break
            cursor += 1
        else:
            break
    return entries


def parse_point_object(raw_object: str) -> dict[str, str]:
    pairs = re.findall(r'(\w+):\s*"((?:[^"\\]|\\.)*)"', raw_object)
    parsed = {}
    for key, value in pairs:
        parsed[key] = bytes(value, "utf-8").decode("unicode_escape")
    return parsed


def serialize_point(point: dict[str, str]) -> str:
    field_order = [
        "name",
        "subtitle",
        "rawCoordinates",
        "type",
        "theme",
        "phase",
        "visitDate",
        "visitEnd",
        "reserveBy",
        "mapyUrl",
        "notionUrl",
    ]
    pieces = [f'{key}: "{js_escape(point.get(key, ""))}"' for key in field_order]
    return "      { " + ", ".join(pieces) + " }"


def load_raw_points(index_text: str) -> tuple[str, list[PointRecord], str]:
    match = re.search(r"(const rawPoints = \[)(.*?)(\n\s*\];)", index_text, flags=re.S)
    if not match:
        raise RuntimeError("Nepodarilo se najit rawPoints v index.html")
    prefix, body, suffix = match.group(1), match.group(2), match.group(3)
    records: list[PointRecord] = []
    for _, _, raw_object in scan_js_object_literals(body):
        parsed = parse_point_object(raw_object)
        notion_url = parsed.get("notionUrl", "")
        records.append(PointRecord(parsed, raw_object, notion_url, extract_page_id(notion_url)))
    return prefix, records, suffix


def insert_index_for_point(points: list[PointRecord], phase: str, visit_date: str) -> int:
    phase_indexes = [idx for idx, point in enumerate(points) if point.data.get("phase", "") == phase]
    if not phase_indexes:
        return len(points)
    if not visit_date:
        return phase_indexes[-1] + 1
    insertion = phase_indexes[-1] + 1
    for idx in phase_indexes:
        existing_date = points[idx].data.get("visitDate", "")
        if existing_date and existing_date > visit_date:
            insertion = idx
            break
    return insertion


def update_index_points(index_text: str, marked_items: list[dict[str, Any]]) -> str:
    match = re.search(r"(const rawPoints = \[)(.*?)(\n\s*\];)", index_text, flags=re.S)
    if not match:
        raise RuntimeError("Nepodarilo se najit rawPoints v index.html")
    prefix, records, suffix = load_raw_points(index_text)
    page_map = {record.page_id: idx for idx, record in enumerate(records) if record.page_id}

    for item in marked_items:
        page_id = item["pageId"]
        point_data = {
            "name": item["title"],
            "subtitle": item["subtitle"],
            "rawCoordinates": item["coordinates"],
            "type": item["type"],
            "theme": item["theme"],
            "phase": item["phase"],
            "visitDate": item["visitDate"],
            "visitEnd": item.get("visitEnd", ""),
            "reserveBy": item["reserveBy"],
            "mapyUrl": item["mapyUrl"],
            "notionUrl": item["notionUrl"],
        }
        point_raw = serialize_point(point_data)
        record = PointRecord(point_data, point_raw, item["notionUrl"], page_id)
        if page_id in page_map:
            records[page_map[page_id]] = record
        else:
            insert_at = insert_index_for_point(records, item["phase"], item["visitDate"])
            records.insert(insert_at, record)
            page_map = {point.page_id: idx for idx, point in enumerate(records) if point.page_id}

    new_body = "\n" + ",\n".join(record.raw for record in records) + "\n"
    return index_text[: match.start(1)] + prefix + new_body + suffix + index_text[match.end(3):]


def scan_detail_chunks(file_text: str) -> tuple[str, list[tuple[str, str]], str]:
    if "window.MAP_DETAILS = Object.assign({}, window.FLORES_DETAILS || {}, {" in file_text:
        marker = "window.MAP_DETAILS = Object.assign({}, window.FLORES_DETAILS || {}, {"
        start = file_text.find(marker)
        if start < 0:
            raise RuntimeError("Nepodarilo se najit uvodni marker map-details.js")
        prefix_end = start + len(marker)
        suffix_start = file_text.rfind("});")
        if suffix_start < 0:
            raise RuntimeError("Nepodarilo se najit zaverecny marker map-details.js")
        prefix = file_text[:prefix_end]
        body = file_text[prefix_end:suffix_start]
        suffix = file_text[suffix_start:]
    elif "window.FLORES_DETAILS = {" in file_text:
        marker = "window.FLORES_DETAILS = {"
        start = file_text.find(marker)
        if start < 0:
            raise RuntimeError("Nepodarilo se najit uvodni marker flores-details.js")
        prefix_end = start + len(marker)
        suffix_start = file_text.rfind("};")
        if suffix_start < 0:
            raise RuntimeError("Nepodarilo se najit zaverecny marker flores-details.js")
        prefix = file_text[:prefix_end]
        body = file_text[prefix_end:suffix_start]
        suffix = file_text[suffix_start:]
    else:
        raise RuntimeError("Nepodarilo se rozpoznat format detailoveho souboru")
    return prefix, scan_top_level_detail_entries(body), suffix


def serialize_detail_entry(notion_url: str, detail: dict[str, Any]) -> str:
    tips = ",\n".join(f'      "{js_escape(tip)}"' for tip in detail["tips"])
    images = ",\n".join(f'      "{js_escape(image)}"' for image in detail["images"])
    return (
        f'  "{js_escape(notion_url)}": {{\n'
        f'    shortDescription: "{js_escape(detail["shortDescription"])}",\n'
        f'    detailText: "{js_escape(detail["detailText"])}",\n'
        f'    tips: [\n{tips}\n    ],\n'
        f'    primaryImage: "{js_escape(detail["primaryImage"])}",\n'
        f'    images: [\n{images}\n    ]\n'
        f"  }}"
    )


def replace_detail_chunks(file_text: str, detail_items: list[dict[str, Any]], target_bucket: str) -> str:
    prefix, chunks, suffix = scan_detail_chunks(file_text)
    page_to_key = {extract_page_id(key): key for key, _ in chunks}
    chunk_map = {key: value for key, value in chunks}

    for item in detail_items:
        page_id = item["pageId"]
        old_key = page_to_key.get(page_id)
        if old_key:
            chunk_map.pop(old_key, None)
        if phase_bucket(item["phase"]) == target_bucket:
            chunk_map[item["notionUrl"]] = serialize_detail_entry(item["notionUrl"], item["detail"])

    ordered_keys = sorted(chunk_map.keys(), key=lambda key: normalize_for_compare(key))
    joined = ",\n".join(chunk_map[key] for key in ordered_keys)
    return prefix + "\n" + joined + "\n" + suffix


def ensure_text(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8", newline="\n")


def fetch_page_detail(token: str, item: dict[str, Any], skip_downloads: bool) -> dict[str, Any]:
    blocks = flatten_blocks(token, item["pageId"])
    summary = summarize_page_content(item["title"], blocks)
    entry_type, theme = choose_type_and_theme(item, summary["shortDescription"])
    subtitle = make_subtitle(summary["shortDescription"])
    image_paths = download_images(summary["imageUrls"], item["title"], item["phase"], skip_downloads)
    detail = {
        "shortDescription": summary["shortDescription"],
        "detailText": summary["detailText"],
        "tips": summary["tips"] or [summary["shortDescription"]],
        "primaryImage": image_paths[0] if image_paths else "",
        "images": image_paths,
    }
    enriched = dict(item)
    enriched["type"] = entry_type
    enriched["theme"] = theme
    enriched["subtitle"] = subtitle
    enriched["detail"] = detail
    return enriched


def fallback_detail_from_item(item: dict[str, Any]) -> dict[str, Any]:
    entry_type, theme = choose_type_and_theme(item, item.get("title", ""))
    short_description = item.get("title", "")
    subtitle = make_subtitle(short_description)
    detail = {
        "shortDescription": short_description,
        "detailText": short_description,
        "tips": ["Detail se z Notionu nepodarilo nacist automaticky, otevri zdrojovou kartu."],
        "primaryImage": "",
        "images": [],
    }
    enriched = dict(item)
    enriched["type"] = entry_type
    enriched["theme"] = theme
    enriched["subtitle"] = subtitle
    enriched["detail"] = detail
    enriched["detailFetchFailed"] = True
    return enriched


def write_json(path: Path, payload: Any) -> None:
    ensure_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Synchronize marked Notion points into the Azory map.")
    parser.add_argument("--skip-downloads", action="store_true", help="Skip image downloads and keep existing local images only.")
    args = parser.parse_args()

    token = os.environ.get("NOTION_TOKEN", "").strip()
    if not token:
        print("NOTION_TOKEN nebyl nalezen v aktualni shell relaci.", file=sys.stderr)
        return 1

    marked_items = query_marked_items(token)
    write_json(
        SYNC_JSON_PATH,
        {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "source": {
                "dataSourceId": DATA_SOURCE_ID,
                "notionVersion": NOTION_VERSION,
                "filter": {"property": "Aktualizovat na webu", "checkboxEquals": True},
            },
            "count": len(marked_items),
            "items": marked_items,
        },
    )

    detailed_items = []
    failed_pages: list[dict[str, str]] = []
    for item in marked_items:
        try:
            enriched = fetch_page_detail(token, item, args.skip_downloads)
        except Exception as exc:
            failed_pages.append(
                {
                    "title": item.get("title", ""),
                    "pageId": item.get("pageId", ""),
                    "notionUrl": item.get("notionUrl", ""),
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )
            enriched = fallback_detail_from_item(item)
        detailed_items.append(enriched)

    write_json(
        DETAIL_CACHE_PATH,
        {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "count": len(detailed_items),
            "items": detailed_items,
            "failedPages": failed_pages,
        },
    )

    index_text = INDEX_PATH.read_text(encoding="utf-8")
    map_details_text = MAP_DETAILS_PATH.read_text(encoding="utf-8")
    flores_details_text = FLORES_DETAILS_PATH.read_text(encoding="utf-8")

    updated_index = update_index_points(index_text, detailed_items)
    updated_map_details = replace_detail_chunks(map_details_text, detailed_items, "saomiguel")
    updated_flores_details = replace_detail_chunks(flores_details_text, detailed_items, "flores")

    ensure_text(INDEX_PATH, updated_index)
    ensure_text(MAP_DETAILS_PATH, updated_map_details)
    ensure_text(FLORES_DETAILS_PATH, updated_flores_details)

    updated_count = len(detailed_items)
    print(f"Synchronizovano {updated_count} oznacenych Notion karet.")
    if failed_pages:
        print(f"Varovani: {len(failed_pages)} karet spadlo na detailu a byly zapsany s nouzovym detailem.")
        for failed_page in failed_pages:
            print(f"- {failed_page['title']} ({failed_page['pageId']}): {failed_page['error']}")
    print(str(SYNC_JSON_PATH))
    print(str(DETAIL_CACHE_PATH))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
