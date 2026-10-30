#!/usr/bin/env bash
# Rebuild output.log from the raw artifacts already in this evidence directory.
# Run from the repository root: bash evidence/verification/docgen-fidelity/<ts>/build-output-log.sh
set -u
D="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$D/../../../.." && pwd)"
cd "$ROOT"
{
echo "# docgen fidelity evidence — raw command output"
echo "# evidence dir: ${D#$ROOT/}"
echo "# generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo
echo "## environment"
echo '$ python3 --version'; python3 --version
echo '$ .toolchain/bin/bun --version'; .toolchain/bin/bun --version
echo 'python deps:'
PYTHONPATH="$ROOT/.mpd/tmp/t3/pydeps" python3 -c 'import openpyxl,docx,lxml; print("openpyxl",openpyxl.__version__,"| python-docx",docx.__version__,"| lxml",lxml.__version__)'
echo
echo "## input hashes"
sha256sum /home/haroldzhao/eCap/docs/user-manual.md /home/haroldzhao/eCap/docs/regExcel_full.xlsx /home/haroldzhao/eCap/docs/eCap_reg_user_manual.docx
echo
echo "## generation run 1 (mpd_docgen_run execute)"
echo '$ .toolchain/bin/bun '"${D#$ROOT/}"'/invoke-tools.ts run '"${D#$ROOT/}"'/generated run1'
cat "$D/run1.raw"
echo
echo "## generation run 2 (byte-identity rerun)"
echo '$ .toolchain/bin/bun '"${D#$ROOT/}"'/invoke-tools.ts run '"${D#$ROOT/}"'/generated-rerun run2'
cat "$D/run2.raw"
echo
echo "## independent sha256 + byte identity"
sha256sum "$D/generated"/* "$D/generated-rerun"/*
for f in eCap_regExcel_full.xlsx eCap_reg_user_manual.zh-CN.docx; do
  if cmp "$D/generated/$f" "$D/generated-rerun/$f"; then echo "cmp: IDENTICAL $f"; else echo "cmp: DIFFERS $f"; fi
done
echo
echo "## mpd_docgen_verify (ours xlsx + ours zh-CN docx)"
echo '$ .toolchain/bin/bun '"${D#$ROOT/}"'/invoke-tools.ts verify <ours.xlsx> <ours.zh-CN.docx>'
cat "$D/verify.raw"
echo
echo "## negative control A: one-string header edit in a copied xlsx"
echo "mutation: xl/worksheets/sheet1.xml 'register name' -> 'wrong register name'"
echo '$ .toolchain/bin/bun '"${D#$ROOT/}"'/invoke-tools.ts verify <tampered-header-surgical.xlsx> <ours.zh-CN.docx>'
cat "$D/negative-control/verify-tampered-xlsx.json"
echo
echo "## negative control B: removed word/settings.xml from a copied docx"
echo "mutation: zip entry word/settings.xml removed (1 of the 9 required parts)"
echo '$ .toolchain/bin/bun '"${D#$ROOT/}"'/invoke-tools.ts verify <ours.xlsx> <tampered-no-settings.docx>'
cat "$D/negative-control/verify-tampered-docx.json"
echo
echo "## independent python oracle (openpyxl + python-docx)"
echo '$ PYTHONPATH=.mpd/tmp/t3/pydeps python3 '"${D#$ROOT/}"'/oracle.py <ours.xlsx> <ecap.xlsx> <ours.docx> <ecap.docx> <run1.json> <run2.json> <verify.json> <control-xlsx.json> <control-docx.json> <outdir>'
cat "$D/oracle.stdout"
echo
echo "## evidence inventory"
ls -la "$D" "$D/generated" "$D/generated-rerun" "$D/negative-control"
echo
echo "## scope check: git status (this lane only adds evidence/verification/docgen-fidelity/<ts>/)"
git status --porcelain | sed -n '1,80p'
} > "$D/output.log" 2>&1
echo "wrote $D/output.log"
