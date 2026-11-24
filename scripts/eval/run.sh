#!/bin/bash
# Generates every eval topic with one model.
#   scripts/eval/run.sh <arm> <model> [topics file=scripts/eval/topics.tsv] [parallel=2]
# Writes out/eval/<arm>/<topic>.{txt,log,trace.json}; topics already written are skipped, so a run can resume.
# Extra settings pass through the environment. SCENES sets the scene option: unset gives --scenes=4-6 (the older evals);
# SCENES= (empty) runs the default length the way a person would get it; SCENES=--length=long asks for a length.
set -u
arm=$1; model=$2; root=$(cd "$(dirname "$0")/../.." && pwd)
topics=${3:-$root/scripts/eval/topics.tsv}; par=${4:-2}
topics=$(readlink -f "$topics")
dir=$root/out/eval/$arm
mkdir -p "$dir"; cd "$dir"; rm -f progress.log
one() {
  local name=$1 topic=$2
  if [ -s "$dir/$name.txt" ]; then echo "skip $name" >> "$dir/progress.log"; return; fi
  node "$root/packages/llm/dist/cli.js" "$topic" -o "$dir/$name.txt" ${SCENES---scenes=4-6} --domain=tech --provider=claude --model="$model" > "$dir/$name.log" 2>&1
  echo "done $name" >> "$dir/progress.log"
}
while IFS=$'\t' read -r name topic; do
  [ -z "$name" ] && continue
  while [ "$(jobs -rp | wc -l)" -ge "$par" ]; do sleep 2; done
  one "$name" "$topic" &
done < "$topics"
wait
echo ALLDONE >> "$dir/progress.log"
