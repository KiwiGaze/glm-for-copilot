/**
 * In-prompt text shapes for the vision proxy. Kept English and out of i18n so
 * the prompt the text model sees — and therefore the token estimate and cache
 * behavior — does not vary with the VS Code display language.
 */

import { VISION_MCP_LABEL } from '../../consts';

/**
 * Replaces the image parts when a description cannot be produced (describe
 * failure, empty response, or a rejected image). Instructs the model to carry
 * on and to tell the user that the image could not be analyzed.
 */
export const IMAGE_DESCRIPTION_UNAVAILABLE =
	'[Image analysis unavailable. Continue helping the user as best you can, and tell them that the attached image(s) could not be analyzed.]';

/** Wrap a successful description with a stable, self-describing header/footer. */
export function describedImageText(count: number, description: string): string {
	return `[${count} attached image(s), described by ${VISION_MCP_LABEL}]\n${description}\n[End of image description]`;
}
