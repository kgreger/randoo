"""A tiny rule language for deciding which category an OSM element belongs to.

A rule is a function from an element's tags to True/False that also knows how
to describe itself (for the documentation) and which tag keys it reads (so the
data pipeline knows which tags it has to keep). Rules combine with `&`, `|`
and `~`:

    eq("amenity", "fast_food") & ~tok("cuisine", "kebab", "doner")

The language is deliberately small. Anything a rule cannot say clearly belongs
in a named constant next to the category that uses it, not in a bigger language.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass

Tags = Mapping[str, str]


@dataclass(frozen=True)
class Rule:
    test: Callable[[Tags], bool]
    description: str
    keys: frozenset[str]

    def __call__(self, tags: Tags) -> bool:
        return self.test(tags)

    def __and__(self, other: "Rule") -> "Rule":
        return Rule(
            lambda tags: self(tags) and other(tags),
            f"({self.description} and {other.description})",
            self.keys | other.keys,
        )

    def __or__(self, other: "Rule") -> "Rule":
        return Rule(
            lambda tags: self(tags) or other(tags),
            f"({self.description} or {other.description})",
            self.keys | other.keys,
        )

    def __invert__(self) -> "Rule":
        return Rule(lambda tags: not self(tags), f"not {self.description}", self.keys)


def _tokens(value: str | None) -> set[str]:
    """OSM lists several values in one tag separated by semicolons
    (cuisine=kebab;pizza). Tokens are compared case-insensitively."""
    if not value:
        return set()
    return {token.strip().lower() for token in value.split(";") if token.strip()}


def eq(key: str, *values: str) -> Rule:
    """The tag has exactly one of these values."""
    wanted = frozenset(values)
    return Rule(lambda tags: tags.get(key) in wanted, f"{key}={'|'.join(values)}", frozenset({key}))


def tok(key: str, *values: str) -> Rule:
    """At least one of the semicolon-separated values of the tag is one of these."""
    wanted = {value.lower() for value in values}
    return Rule(
        lambda tags: bool(_tokens(tags.get(key)) & wanted),
        f"{key} has {'|'.join(values)}",
        frozenset({key}),
    )


def has(*keys: str) -> Rule:
    """At least one of these tags is present and not empty."""
    return Rule(
        lambda tags: any(tags.get(key) for key in keys),
        f"has {'|'.join(keys)}",
        frozenset(keys),
    )


def lacks(key: str) -> Rule:
    """The tag is absent or empty."""
    return Rule(lambda tags: not tags.get(key), f"no {key}", frozenset({key}))


def text(keys: tuple[str, ...], *needles: str) -> Rule:
    """One of these tags contains one of these words (any case), as in a note
    saying "Wasserstelle Friedhof"."""
    lowered = tuple(needle.lower() for needle in needles)

    def test(tags: Tags) -> bool:
        haystack = " ".join(tags.get(key, "") for key in keys).lower()
        return any(needle in haystack for needle in lowered)

    return Rule(test, f"{'|'.join(keys)} mentions {'|'.join(needles)}", frozenset(keys))


ALWAYS = Rule(lambda tags: True, "always", frozenset())
