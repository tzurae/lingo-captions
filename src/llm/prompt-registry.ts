import type { PromptTemplates, QueryRequest } from '../domain/types';
import { defaultPromptTemplates, renderPromptTemplate } from './prompt-templates';

export interface PromptRegistry {
  buildInstructions(request: QueryRequest): string;
  buildInput(request: QueryRequest): string;
}

export class ConfiguredPromptRegistry implements PromptRegistry {
  constructor(private readonly templates: PromptTemplates) {}

  buildInstructions(request: QueryRequest): string {
    return renderPromptTemplate(this.templates.basePrompt, {
      outputLanguage: request.outputLanguage,
      detailLevel: request.detailLevel,
      intentPrompt: this.templates.intentPrompts[request.intent],
    });
  }

  buildInput(request: QueryRequest): string {
    return renderPromptTemplate(this.templates.inputPrompt, {
      intent: request.intent,
      selectedText: request.selectedText,
      sentence: request.sentence,
      contextBefore: request.contextBefore.join(' '),
      contextAfter: request.contextAfter.join(' '),
      customQuestion: request.customQuestion ?? '',
    });
  }
}

export class DefaultPromptRegistry extends ConfiguredPromptRegistry {
  constructor() {
    super(defaultPromptTemplates);
  }
}
