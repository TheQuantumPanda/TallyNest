# Development rules

- Preserve the Node.js 24 LTS, Express, MongoDB/Mongoose, React, Vite, and Tailwind CSS v4 stack. Use ECMAScript modules and JavaScript.
- Follow Controller → Service → Repository → Model architecture as features are added.
- Keep business logic out of routes; routes wire middleware and controllers.
- Use Zod for input and environment validation.
- Prefer secure, maintainable implementations.
- Never commit credentials or environment secrets. Keep `.env` files ignored and provide placeholder configuration in `.env.example`.
- Use integer minor currency units for monetary calculations in future finance features.
- Write automated tests for financial calculations, including boundary cases.
- Do not introduce paid APIs or services without approval.
- Avoid unrelated refactoring and unnecessary dependencies.
- Do not modify the frontend during Phase 1, Step 2: Backend Foundation.
- Keep application tests independent of a running MongoDB instance; report live database checks separately.
