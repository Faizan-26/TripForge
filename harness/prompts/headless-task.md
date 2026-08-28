Process this TripForge request under the supervisor policy.

Request:
{{USER_MESSAGE}}

Known context:
{{REQUEST_CONTEXT}}

Known context is cumulative for this TripForge conversation. Its `answers` object contains the traveler's authoritative answers to every earlier clarification round, and `draft` contains facts already extracted or confirmed. Merge both with the original request. Never ask for a field represented in `answers` or `draft`, even if the wording or question ID would differ. Continue to a result when the combined information is complete.

When grounded hotel tool results contain several suitable properties and no `hotel_selection` answer exists, return a clarification with exactly one `single_select` question named `hotel_selection` and 3 to 5 options. Use each Google place ID as `value` and the hotel name as `label`. The TripForge tool boundary adds the grounded image and decision metadata. Never include unverified price or availability. If `hotel_selection` is already answered, continue with that selection instead of offering the same decision again.

Call `submit_trip_response` exactly once with `outcome` and the response fields as direct tool arguments. Do not print the JSON separately. If the terminal tool is unavailable, return only the JSON object as a compatibility fallback.

If required details are missing:
{"outcome":"clarification","ui_schema_version":"1","draft":{},"questions":[{"id":"snake_case","kind":"single_select|multi_select|text|textarea|location|number|date|date_range|boolean","prompt":"...","required":true,"options":[]}],"conversation_title":"..."}

Ask all relevant missing details together, at most 8 questions. Before submitting them, remove every question already resolved by the request, `answers`, or `draft`; submit only genuinely missing fields. Preserve all known facts in `draft`. Use `date_range` for check-in/check-out or trip start/end dates. Select questions require non-empty `{value,label}` options; otherwise use location, date, date_range, number, text, textarea, or boolean.

Use `kind:"text"` for a combined traveler-composition question that asks for both adults and children, with a placeholder such as `2 adults and 1 child`. Use `kind:"number"` only when one question requests one numeric value.

If enough information exists, research only when useful and return a short fallback `message` plus a website-ready presentation:
{"outcome":"general","message":"One or two sentence summary.","conversation_title":"...","presentation":{"kind":"trip_plan|travel_answer|hotel_advice","title":"...","summary":"...","facts":[{"label":"Dates","value":"..."}],"sections":[{"title":"Day 1 — ...","subtitle":"...","items":[{"time":"Morning","title":"...","description":"...","location":"...","maps_url":"https://..."}]}],"notes":["..."]}}

Keep the complete response compact: at most 8 facts, 12 sections, 4 items per section, and 6 notes. Prefer one useful sentence per item. Put verified Google Maps URLs only on the matching item. Do not repeat the same fact in `message`, `summary`, facts, and notes. Output no Markdown fence, HTML, UI code, unsupported fields, or prose outside the tool call or compatibility JSON.
