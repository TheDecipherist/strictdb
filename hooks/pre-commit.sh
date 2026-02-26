#!/bin/bash
# StrictDB Pre-Commit Hook
# Blocks commits that import database drivers directly
# Install: cp hooks/pre-commit.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

set -e

BANNED_IMPORTS=(
  "from 'mongodb'"
  "from \"mongodb\""
  "from 'mongoose'"
  "from \"mongoose\""
  "from 'pg'"
  "from \"pg\""
  "from 'sequelize'"
  "from \"sequelize\""
  "from '@prisma/client'"
  "from \"@prisma/client\""
  "from 'drizzle-orm'"
  "from \"drizzle-orm\""
  "from 'mysql2'"
  "from \"mysql2\""
  "from 'mssql'"
  "from \"mssql\""
  "from '@elastic/elasticsearch'"
  "from \"@elastic/elasticsearch\""
  "from 'knex'"
  "from \"knex\""
)

# Only check staged .ts and .js files (exclude strictdb source and node_modules)
FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|js)$' | grep -v 'node_modules' | grep -v 'src/core/' | grep -v 'src/adapters/')

if [ -z "$FILES" ]; then
  exit 0
fi

FOUND=0

for file in $FILES; do
  for pattern in "${BANNED_IMPORTS[@]}"; do
    if grep -q "$pattern" "$file" 2>/dev/null; then
      echo "ERROR: Direct database driver import found in $file"
      echo "  Pattern: $pattern"
      echo "  Fix: Use 'import { StrictDB } from \"strictdb\"' instead"
      echo ""
      FOUND=1
    fi
  done
done

if [ $FOUND -eq 1 ]; then
  echo "============================================"
  echo "COMMIT BLOCKED: Direct database driver imports detected."
  echo "All database operations must go through StrictDB."
  echo "See: https://github.com/TheDecipherist/strictdb"
  echo "============================================"
  exit 1
fi

exit 0
