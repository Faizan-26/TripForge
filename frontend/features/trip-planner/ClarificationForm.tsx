"use client";

import { FormEvent, useState } from "react";
import type { AnswerValue, ClarificationResult } from "@/lib/trip-api/types";
import styles from "@/app/chat/new/chat.module.css";

export function ClarificationForm({
  clarification,
  disabled,
  onSubmit,
}: {
  clarification: ClarificationResult;
  disabled: boolean;
  onSubmit: (answers: Record<string, AnswerValue>) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [validation, setValidation] = useState("");

  function update(id: string, value: AnswerValue) {
    setAnswers((current) => ({ ...current, [id]: value }));
    setValidation("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missing = clarification.questions.find((question) => {
      const answer = answers[question.id];
      return question.required && (!answer || (Array.isArray(answer) && answer.length === 0));
    });
    if (missing) {
      setValidation(`Choose an answer for “${missing.prompt}”`);
      return;
    }
    await onSubmit(answers);
  }

  return <form className={styles.clarification} onSubmit={submit}>
    <h2>Shape the trip</h2>
    <p>Answer these before the research agents begin.</p>
    <div className={styles.questionList}>
      {clarification.questions.map((question) => <fieldset key={question.id}>
        <legend>{question.prompt}</legend>
        {question.options.length > 0 ? <div className={styles.optionGrid}>
          {question.options.map((option) => {
            const multiple = question.kind === "multi_select";
            const currentAnswer = answers[question.id];
            const selected = multiple
              ? Array.isArray(currentAnswer) && currentAnswer.includes(option.value)
              : currentAnswer === option.value;
            return <label className={selected ? styles.optionSelected : ""} key={option.value}>
              <input
                type={multiple ? "checkbox" : "radio"}
                name={question.id}
                value={option.value}
                checked={selected}
                onChange={() => {
                  if (!multiple) return update(question.id, option.value);
                  const current = Array.isArray(answers[question.id]) ? answers[question.id] as string[] : [];
                  update(question.id, selected
                    ? current.filter((value) => value !== option.value)
                    : [...current, option.value]);
                }}
              />
              <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
            </label>;
          })}
        </div> : <input
          className={styles.clarificationInput}
          type={question.kind === "number" ? "number" : "text"}
          inputMode={question.kind === "number" ? "numeric" : undefined}
          min={question.kind === "number" ? 1 : undefined}
          max={question.kind === "number" ? 50 : undefined}
          maxLength={question.kind === "number" ? undefined : 300}
          placeholder={question.kind === "location" ? "City, region, or address" : "Type your answer"}
          onChange={(event) => update(question.id, event.target.value)}
        />}
      </fieldset>)}
    </div>
    {validation && <p className={styles.formError} role="alert">{validation}</p>}
    <button className={styles.continueButton} type="submit" disabled={disabled}>
      {disabled ? "Continuing…" : "Continue planning"}
    </button>
  </form>;
}
