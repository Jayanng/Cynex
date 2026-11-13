# Frontend toolchain evidence (2026-11-03)

node v22.23.3
npm 10.9.9
near-api-js and near-kit: installed in frontend/ for 
verification (see frontend/package.json). Import resolution is
checked by running node with those imports in frontend/.

Skills loaded for frontend work:
near-api-js, near-kit, near-ai-cloud, near-cli-rs
Note: NEP-141 receivers must be registered via storage_deposit
before they can hold tokens, confirmed by storage_balance_of.

frontend scaffold directories created (no code yet):
services/, agent/, frontend/, cli/, demo/, tests/integration/

Correction: first attempt used @near-kit/core, which does not exist
on npm (404). Corrected per the near-kit skill to package name near-kit
version ^0.20.0. npm install then added 85 packages in 4s, exit 0.
Import check passed: near-api-js OK (Account, etc.), near-kit OK
(Amount, ContractNotDeployedError, etc.).

Import check, temp file check-imports.mjs run in frontend/ then removed to keep the repo clean: near-api-js OK (Account, ArgumentSchemaError, ArgumentTypeError, Assignable, ConflictingOptions), near-kit OK (AccessKeyDoesNotExistError, AccountDoesNotExistError, Amount, ContractNotDeployedError, DELEGATE_ACTION_PREFIX, DELEGATE_ACTION_V2_PREFIX, DelegateAction, DelegateActionV2). Exit 0.
