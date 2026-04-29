#!/usr/bin/env bash
#
# Build a Claude Code plugin distribution from the flat-layout repo.
#
# Reads each skill folder at the repo root and assembles them under
#   dist/tld-plugin/
#     .claude-plugin/plugin.json
#     skills/<name>/...
#
# Inside each copied skills/<name>/SKILL.md, rewrites cross-references:
#   /tld-x        -> /tld:x
#   /campaign-x   -> /tld:campaign-x
#   /milestone-x  -> /tld:milestone-x
#
# The version field in plugin.json is parsed from the latest `## [vX.Y.Z...]`
# heading in CHANGELOG.md.
#
# Idempotent: removes dist/ before rebuilding.
#
# Tracked in 2ND-215.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${REPO_ROOT}/dist/tld-plugin"
CHANGELOG="${REPO_ROOT}/CHANGELOG.md"

PLUGIN_NAME="tld"
PLUGIN_DESCRIPTION="Test-Led Development skills for Claude Code — milestone-driven workflow over Linear."
PLUGIN_AUTHOR_NAME="Jbrawner"
PLUGIN_AUTHOR_URL="https://github.com/Jbrawner/tld-skills"

# Directories at repo root that are NOT skills.
NON_SKILL_DIRS=(
    ".git"
    ".tld"
    ".claude"
    "dist"
    "docs"
    "scripts"
    "node_modules"
    "__pycache__"
)

# --- helpers --------------------------------------------------------------

is_non_skill_dir() {
    local name="$1"
    for n in "${NON_SKILL_DIRS[@]}"; do
        [[ "$name" == "$n" ]] && return 0
    done
    return 1
}

# Parse version from the first `## [vX.Y.Z...]` heading in CHANGELOG.md.
parse_version() {
    local line
    line="$(grep -m1 -E '^## \[v[^]]+\]' "$CHANGELOG" || true)"
    if [[ -z "$line" ]]; then
        echo "ERROR: no '## [vX.Y.Z...]' heading found in CHANGELOG.md" >&2
        exit 1
    fi
    # Strip the leading `## [` and trailing `]...` keep the version core.
    local version="${line#*[}"
    version="${version%%]*}"
    # Drop the leading 'v' so plugin.json carries a clean SemVer-ish string.
    version="${version#v}"
    echo "$version"
}

write_plugin_json() {
    local version="$1"
    mkdir -p "${DIST_DIR}/.claude-plugin"
    cat > "${DIST_DIR}/.claude-plugin/plugin.json" <<EOF
{
  "name": "${PLUGIN_NAME}",
  "description": "${PLUGIN_DESCRIPTION}",
  "version": "${version}",
  "author": {
    "name": "${PLUGIN_AUTHOR_NAME}",
    "url": "${PLUGIN_AUTHOR_URL}"
  }
}
EOF
}

# Rewrite cross-references in a single SKILL.md in place.
# `/campaign-` and `/milestone-` first so their results (`/tld:campaign-`,
# `/tld:milestone-`) are no longer matches for the `/tld-` pattern.
rewrite_refs() {
    local file="$1"
    # `sed -i ''` is BSD/macOS form; works on GNU sed too with a tiny tweak,
    # but the repo's primary platform is macOS so we target BSD behavior.
    sed -i '' \
        -e 's|/campaign-\([a-z]\)|/tld:campaign-\1|g' \
        -e 's|/milestone-\([a-z]\)|/tld:milestone-\1|g' \
        -e 's|/tld-\([a-z]\)|/tld:\1|g' \
        "$file"
}

# --- build ----------------------------------------------------------------

VERSION="$(parse_version)"

rm -rf "${REPO_ROOT}/dist"
mkdir -p "${DIST_DIR}/skills"

write_plugin_json "$VERSION"

skill_count=0
for entry in "${REPO_ROOT}"/*/; do
    name="$(basename "$entry")"
    is_non_skill_dir "$name" && continue
    [[ -f "${entry}SKILL.md" ]] || continue

    cp -R "$entry" "${DIST_DIR}/skills/${name}"
    if [[ -f "${DIST_DIR}/skills/${name}/SKILL.md" ]]; then
        rewrite_refs "${DIST_DIR}/skills/${name}/SKILL.md"
    fi
    skill_count=$((skill_count + 1))
done

# --- summary --------------------------------------------------------------

echo "Built tld plugin v${VERSION}"
echo "  Skills:     ${skill_count}"
echo "  Output:     ${DIST_DIR#${REPO_ROOT}/}"
echo "  plugin.json ${DIST_DIR#${REPO_ROOT}/}/.claude-plugin/plugin.json"
