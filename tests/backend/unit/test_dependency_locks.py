"""Guards the dependency locks.

Every package used to be specified with `>=`, and CI additionally installed its
test tools unversioned, so a breaking upstream release could reach production
through the deploy job's `pip install` without a single line of this repository
changing. The locks close that; these tests keep them honest.
"""

import re
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parents[3] / "server"

RUNTIME_IN = SERVER / "requirements.in"
RUNTIME_LOCK = SERVER / "requirements.txt"
DEV_IN = SERVER / "requirements-dev.in"
DEV_LOCK = SERVER / "requirements-dev.txt"


def _canonical(name: str) -> str:
    """PEP 503 normalisation - `pytest_asyncio`, `PyJWT` and `pyjwt` are one."""
    return re.sub(r"[-_.]+", "-", name).lower()


def _direct_requirements(path: Path) -> set[str]:
    """Package names from a `.in` file, ignoring extras, markers and includes."""
    names = set()
    for line in path.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        name = re.split(r"[\[<>=!~;]", line, maxsplit=1)[0].strip()
        if name:
            names.add(_canonical(name))
    return names


def _locked_versions(path: Path) -> dict[str, str]:
    """Map of package -> pinned version from a compiled lock."""
    pins = {}
    for match in re.finditer(r"(?m)^([A-Za-z0-9][A-Za-z0-9._-]*)==([^\s\\;]+)", path.read_text()):
        pins[_canonical(match.group(1))] = match.group(2)
    return pins


@pytest.mark.parametrize("lock", [RUNTIME_LOCK, DEV_LOCK])
def test_lock_file_exists(lock):
    assert lock.is_file(), f"{lock.name} is missing - regenerate it with uv pip compile"


@pytest.mark.parametrize(
    "source, lock",
    [(RUNTIME_IN, RUNTIME_LOCK), (DEV_IN, DEV_LOCK)],
    ids=["runtime", "dev"],
)
def test_every_direct_dependency_is_pinned(source, lock):
    """Catches editing a `.in` file and forgetting to recompile."""
    missing = sorted(_direct_requirements(source) - set(_locked_versions(lock)))
    assert missing == [], (
        f"{sorted(missing)} listed in {source.name} but absent from {lock.name}. "
        "Regenerate the lock - see the header of the .in file."
    )


@pytest.mark.parametrize("lock", [RUNTIME_LOCK, DEV_LOCK], ids=["runtime", "dev"])
def test_nothing_is_left_unpinned(lock):
    """A single `>=` anywhere in a lock defeats --require-hashes."""
    loose = [
        line.strip()
        for line in lock.read_text().splitlines()
        if re.match(r"^[A-Za-z0-9]", line) and "==" not in line
    ]
    assert loose == [], f"{lock.name} contains unpinned entries: {loose}"


@pytest.mark.parametrize("lock", [RUNTIME_LOCK, DEV_LOCK], ids=["runtime", "dev"])
def test_every_pin_carries_a_hash(lock):
    """--require-hashes rejects the whole file if any requirement lacks one."""
    text = lock.read_text()
    pinned = len(re.findall(r"(?m)^[A-Za-z0-9][A-Za-z0-9._-]*==", text))
    hashed = len(re.findall(r"(?m)^\s*--hash=sha256:", text))
    assert pinned > 0
    assert hashed >= pinned, f"{lock.name}: {pinned} pins but only {hashed} hashes"


def test_dev_lock_agrees_with_runtime_lock_on_shared_packages():
    """CI installs the dev lock; the host installs the runtime lock. If they
    disagreed on a shared package, the suite would be exercising a different
    version than production runs - which is the whole failure mode being fixed.
    """
    runtime = _locked_versions(RUNTIME_LOCK)
    dev = _locked_versions(DEV_LOCK)

    divergent = {
        name: (version, dev[name])
        for name, version in runtime.items()
        if name in dev and dev[name] != version
    }
    assert divergent == {}, f"runtime/dev version divergence: {divergent}"

    absent = sorted(set(runtime) - set(dev))
    assert absent == [], f"dev lock is not a superset of the runtime lock; missing {absent}"


def test_locks_target_the_supported_python_floor():
    """`--universal` is what makes one lock valid on 3.10 and on newer hosts.
    Without it, conditional dependencies are pinned unconditionally and the
    install breaks wherever CI and the host disagree on the interpreter."""
    header = RUNTIME_LOCK.read_text()[:400]
    assert "--universal" in header, "lock was not compiled with --universal"
    assert "--python-version 3.10" in header, "lock does not target the documented 3.10 floor"
