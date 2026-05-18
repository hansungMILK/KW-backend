const IMAGE_TARGET_PATTERN = /이미지|그림|사진|일러스트|삽화|썸네일|image|picture|photo|illustration|thumbnail/;
const IMAGE_PRODUCTION_PATTERN = /생성|만들|제작|create|make|generate|produce/;
const DRAW_ACTION_PATTERN = /그려(?:줘라|줘|주세요|주라|줄래|라)?|draw|paint|illustrate|sketch/;

export function normalizeIntentText(input: string): string {
    return input.toLowerCase().replace(/\s+/g, '');
}

export function isImageGenerationRequestText(input: string): boolean {
    const normalized = normalizeIntentText(input);
    return (
        DRAW_ACTION_PATTERN.test(normalized) ||
        (IMAGE_TARGET_PATTERN.test(normalized) && IMAGE_PRODUCTION_PATTERN.test(normalized))
    );
}
