---
"@yagejs-addons/dialogue": minor
---

Script text fields take a `DialogueText`: an authored string or a
`{ key, fallback, values? }` message (the shape `@yagejs-addons/i18n`'s `msg`
returns). `SayStep.text`, `ChoiceStep.text`, `ChoiceOption.text`,
`ChoiceOption.disabledReason`, and `SpeakerDef.name` accept it; the separate
`SayStep.key`, `ChoiceStep.key`, `ChoiceOption.key`, and `SpeakerDef.nameKey`
fields are gone. The compact DSL's `#line:id` tag now produces the message form.

`I18nAdapter` is `{ locale, resolve(text, values?), subscribe?() }` instead of
`{ locale, t(key, fallback, params?) }`. `DialogueController` resolves the
adapter from its `i18n` option, then a service registered under the
`"localization"` id (the `@yagejs-addons/i18n` plugin), then `IdentityI18n`.
When the adapter has `subscribe`, a locale change re-presents the line or
choice menu on screen in place through the new `DialogueSession.retranslate()`:
a line keeps its reveal progress, a menu keeps its highlighted row, and no
event fires.

A `#line:` tag with no catalog key fails at the line that wrote it, and a
message's `values` are checked entry by entry when a script loads.

`TextChannel` has a new required method, `replaceVisible(line)`, which swaps
the text of the line on screen without restarting its reveal. The bundled text
views and `CompositeTextPresenter` implement it; a custom text presenter built
on `LineReveal` implements it by passing the new text to the new
`LineReveal.rebase`.
