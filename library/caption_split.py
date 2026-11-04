"""Deterministic mixed-caption boundaries, independent of training dependencies.

Keep this algorithm in sync with frontend caption-split.ts via the shared fixtures.
"""
import re


def split_caption(text: str) -> dict:
    # A single final line ending terminates a line; it does not add a content line.
    text = re.sub(r"(?:\r\n|\n|\r)$", "", text, count=1)

    def result(tags, natural_language, method, separator=""):
        return dict(tags=tags, natural_language=natural_language, method=method, separator=separator)

    newline = re.search(r"\r\n|\n|\r", text)
    if newline:
        return result(text[:newline.start()], text[newline.end():], "multiline", newline.group())

    # Periods inside words/numbers are not sentence boundaries.
    terminal = re.compile(r"[!?。！？]|(?<![A-Za-z0-9])\.|\.(?![A-Za-z0-9])")
    if not terminal.search(text):
        # Long prose without punctuation is ambiguous: preserve it conservatively.
        candidates = [text] if "," not in text else [
            text[m.start(1):].split(",", 1)[0]
            for m in re.finditer(r"(?:^|, +)([A-Z][A-Za-z]*)\b", text)
        ]
        if any(len(re.findall(r"[A-Za-z]+(?:['’-][A-Za-z]+)*", clause)) >= 6 for clause in candidates):
            return result("", text, "natural_language")
        return result(text, "", "tags")

    for candidate in re.finditer(r"(?:^|, +)([A-Z][A-Za-z]*)\b", text):
        start = candidate.start(1)
        ending = terminal.search(text, start)
        if not ending:
            continue
        clause = text[start:ending.start()].split(",", 1)[0]
        if len(re.findall(r"[A-Za-z]+(?:['’-][A-Za-z]+)*", clause)) >= 6:
            if start == 0:
                return result("", text, "natural_language")
            return result(text[:candidate.start()], text[start:], "mixed", text[candidate.start():start])
    # Punctuation suggests prose, but no reliable boundary was found.
    return result("", text, "natural_language")
