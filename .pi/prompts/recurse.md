---
description: Recursive work-test-evaluate loop until the goal is achieved.
---
Run the `/recurse` workflow for: $@

Each iteration must carry forward the previous failed fixes and error log with the instruction:
"do not repeat fixes that have already failed, try a different approach."
