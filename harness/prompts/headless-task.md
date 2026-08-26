Process this TripForge request under the supervisor policy.

Request:
{{USER_MESSAGE}}

Known context:
{{REQUEST_CONTEXT}}

If Known context contains an `answers` object, those are the traveler's authoritative answers to earlier questions. Merge them with the original request and draft, and never ask an answered question again. Continue to a result when the combined information is complete.

Return only one JSON object.

If required details are missing:
{"outcome":"clarification","ui_schema_version":"1","draft":{},"questions":[{"id":"snake_case","kind":"single_select|multi_select|text|textarea|location|number|date|boolean","prompt":"...","required":true,"options":[]}],"conversation_title":"..."}

Ask all relevant missing details together, at most 8 questions. Preserve known facts in `draft`. Select questions require non-empty `{value,label}` options; otherwise use location, date, number, text, textarea, or boolean.

Use `kind:"text"` for a combined traveler-composition question that asks for both adults and children, with a placeholder such as `2 adults and 1 child`. Use `kind:"number"` only when one question requests one numeric value.

If enough information exists, research only when useful and return:
{"outcome":"general","message":"...","conversation_title":"..."}

Keep `message` concise unless a multi-day itinerary requires detail. Output no Markdown fence, HTML, UI code, unsupported fields, or prose outside the JSON.
