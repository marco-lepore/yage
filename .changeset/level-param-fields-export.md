---
"@yagejs/level": patch
---

Export the `ParamFields` type. `defineParams`, `defineLevelEntity`, `ParamsSchema` and `LevelEntityDeclaration` use it as a constraint, so code that is generic over a parameter schema can now name it.
