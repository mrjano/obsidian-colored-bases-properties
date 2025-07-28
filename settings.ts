import { App, Modal, PluginSettingTab, Setting } from 'obsidian';
import type ColoredPropertyListsPlugin from './main';

export interface ColoredPropertyListsPluginSettings {
	pillColors: Record<string, string>;
}

export const DEFAULT_SETTINGS: ColoredPropertyListsPluginSettings = {
	pillColors: {}
}

export class ColorPickerModal extends Modal {
	private pillName: string;
	private currentColor: string;
	private onColorSelected: (color: string) => void;
	private colorInput: HTMLInputElement;
	private previewPill: HTMLElement;

	constructor(app: App, pillName: string, currentColor: string, onColorSelected: (color: string) => void) {
		super(app);
		this.pillName = pillName;
		this.currentColor = currentColor;
		this.onColorSelected = onColorSelected;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Title
		contentEl.createEl('h2', { text: `Pick color for "${this.pillName}"` });

		// Preview pill
		const previewContainer = contentEl.createDiv('color-preview-container');
		previewContainer.style.marginBottom = '20px';
		previewContainer.style.textAlign = 'center';
		
		this.previewPill = previewContainer.createSpan('property-pill-preview');
		this.previewPill.textContent = this.pillName;
		this.previewPill.style.backgroundColor = this.currentColor;
		this.previewPill.style.color = 'white';
		this.previewPill.style.padding = '6px 16px';
		this.previewPill.style.borderRadius = '12px';
		this.previewPill.style.fontSize = '1em';
		this.previewPill.style.fontWeight = '500';
		this.previewPill.style.display = 'inline-block';

		// Color input
		const inputContainer = contentEl.createDiv('color-input-container');
		inputContainer.style.marginBottom = '20px';
		inputContainer.style.textAlign = 'center';
		
		this.colorInput = inputContainer.createEl('input');
		this.colorInput.type = 'color';
		this.colorInput.value = this.hexFromAnyColor(this.currentColor);
		this.colorInput.style.width = '100px';
		this.colorInput.style.height = '40px';
		this.colorInput.style.border = 'none';
		this.colorInput.style.borderRadius = '8px';
		this.colorInput.style.cursor = 'pointer';
		
		this.colorInput.addEventListener('input', () => {
			const hexColor = this.colorInput.value;
			this.previewPill.style.backgroundColor = hexColor;
		});

		// Buttons
		const buttonContainer = contentEl.createDiv('button-container');
		buttonContainer.style.display = 'flex';
		buttonContainer.style.justifyContent = 'center';
		buttonContainer.style.gap = '10px';

		// OK button
		const okButton = buttonContainer.createEl('button', { text: 'OK' });
		okButton.style.padding = '8px 16px';
		okButton.style.backgroundColor = 'var(--interactive-accent)';
		okButton.style.color = 'white';
		okButton.style.border = 'none';
		okButton.style.borderRadius = '4px';
		okButton.style.cursor = 'pointer';
		okButton.addEventListener('click', () => {
			const hexColor = this.colorInput.value;
			const hslColor = this.hexToHsl(hexColor);
			this.onColorSelected(hslColor);
			this.close();
		});

		// Cancel button
		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.style.padding = '8px 16px';
		cancelButton.style.backgroundColor = 'var(--background-modifier-border)';
		cancelButton.style.color = 'var(--text-normal)';
		cancelButton.style.border = 'none';
		cancelButton.style.borderRadius = '4px';
		cancelButton.style.cursor = 'pointer';
		cancelButton.addEventListener('click', () => {
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	private hexFromAnyColor(color: string): string {
		// If already hex, return as-is
		if (color.startsWith('#')) {
			return color;
		}
		
		// If HSL, convert to hex
		if (color.startsWith('hsl(')) {
			const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
			if (match) {
				const h = parseInt(match[1]);
				const s = parseInt(match[2]) / 100;
				const l = parseInt(match[3]) / 100;
				
				const c = (1 - Math.abs(2 * l - 1)) * s;
				const x = c * (1 - Math.abs((h / 60) % 2 - 1));
				const m = l - c / 2;
				
				let r = 0, g = 0, b = 0;
				
				if (h >= 0 && h < 60) {
					r = c; g = x; b = 0;
				} else if (h >= 60 && h < 120) {
					r = x; g = c; b = 0;
				} else if (h >= 120 && h < 180) {
					r = 0; g = c; b = x;
				} else if (h >= 180 && h < 240) {
					r = 0; g = x; b = c;
				} else if (h >= 240 && h < 300) {
					r = x; g = 0; b = c;
				} else if (h >= 300 && h < 360) {
					r = c; g = 0; b = x;
				}
				
				r = Math.round((r + m) * 255);
				g = Math.round((g + m) * 255);
				b = Math.round((b + m) * 255);
				
				return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
			}
		}
		
		// Fallback - return as-is
		return color;
	}

	private hexToHsl(hex: string): string {
		// Remove # if present
		hex = hex.replace('#', '');
		
		// Parse r, g, b values
		const r = parseInt(hex.substring(0, 2), 16) / 255;
		const g = parseInt(hex.substring(2, 4), 16) / 255;
		const b = parseInt(hex.substring(4, 6), 16) / 255;
		
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		let h = 0, s = 0, l = (max + min) / 2;
		
		if (max === min) {
			h = s = 0; // achromatic
		} else {
			const d = max - min;
			s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
			
			switch (max) {
				case r: h = (g - b) / d + (g < b ? 6 : 0); break;
				case g: h = (b - r) / d + 2; break;
				case b: h = (r - g) / d + 4; break;
			}
			h /= 6;
		}
		
		return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
	}
}

export class ColoredPropertyListsSettingTab extends PluginSettingTab {
	plugin: ColoredPropertyListsPlugin;

	constructor(app: App, plugin: ColoredPropertyListsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		// Clear all button
		if (Object.keys(this.plugin.settings.pillColors).length > 0) {
			new Setting(containerEl)
				.setName('Clear all')
				.setDesc('Remove all detected property list. Colors will be regenerated when you open a Bases file with property lists.')
				.addButton(button => button
					.setButtonText('Clear all')
					.setCta()
					.onClick(async () => {
						// Clear all style rules first
						this.plugin.clearAllColorRules();
						// Clear settings
						this.plugin.settings.pillColors = {};
						await this.plugin.saveSettings();
						// Immediately reprocess to generate new colors
						setTimeout(() => {
							this.plugin.processListProperties();
						}, 50);
						this.display(); // Refresh the settings display
					}));
		}
		
		const pillsContainer = containerEl.createDiv('pills-container');
		
		if (Object.keys(this.plugin.settings.pillColors).length === 0) {
			pillsContainer.createEl('p', {
				text: 'No property list values detected yet. Open a Bases file with property lists to automatically detect values.',
				cls: 'setting-item-description'
			});
		} else {
			Object.keys(this.plugin.settings.pillColors)
				.sort((a, b) => a.localeCompare(b))
				.forEach(pillName => {
					const pillValue = this.plugin.settings.pillColors[pillName];
					
					const setting = new Setting(pillsContainer)
						.addText(text => text
							.setPlaceholder('Enter color (e.g., #FF0000 or hsl(180, 50%, 40%))')
							.setValue(pillValue)
							.onChange(async (value) => {
								this.plugin.settings.pillColors[pillName] = value;
								await this.plugin.saveSettings();
								// Update the style rule immediately
								if (value) {
									this.plugin.updateColorRule(pillName, value);
								}
								// Update the pill preview
								this.updatePillPreview(pillElement, pillName, value);
							}))
						.addExtraButton(button => button
							.setIcon('palette')
							.setTooltip('Pick color')
							.onClick(() => {
								this.showColorPickerModal(pillName, pillValue, (newColor) => {
									// Update settings with HSL format to maintain consistency
									this.plugin.settings.pillColors[pillName] = newColor;
									this.plugin.saveSettings();
									this.plugin.updateColorRule(pillName, newColor);
									// Update the text input and pill preview
									const textInput = setting.controlEl.querySelector('input[type="text"]') as HTMLInputElement;
									if (textInput) textInput.value = newColor;
									this.updatePillPreview(pillElement, pillName, newColor);
								});
							}))
						.addExtraButton(button => button
							.setIcon('reset')
							.setTooltip('Restore default color')
							.onClick(async () => {
								// Generate the default color for this pill
								const sanitized = pillName.replace(/\s+/g, '').replace(/[^\w\u00C0-\u017F-]/g, '');
								const defaultColor = this.plugin.generateColorFromText(sanitized);
								
								// Update settings
								this.plugin.settings.pillColors[pillName] = defaultColor;
								await this.plugin.saveSettings();
								this.plugin.updateColorRule(pillName, defaultColor);
								
								// Update the text input and pill preview
								const textInput = setting.controlEl.querySelector('input[type="text"]') as HTMLInputElement;
								if (textInput) textInput.value = defaultColor;
								this.updatePillPreview(pillElement, pillName, defaultColor);
							}))
						.addButton(button => button
							.setIcon('trash')
							.setTooltip('Delete this property list value')
							.onClick(async () => {
								// Remove the style rule immediately
								const sanitized = pillName.replace(/\s+/g, '').replace(/[^\w\u00C0-\u017F-]/g, '');
								this.plugin.removeColorRule(sanitized);
								
								// Remove data attributes from matching pills so they can be reprocessed
								const pillElements = document.querySelectorAll(`.multi-select-pill[data-sanitized-content="${sanitized}"]`);
								pillElements.forEach((element: Element) => {
									element.removeAttribute('data-sanitized-content');
								});
								
								// Remove from settings
								delete this.plugin.settings.pillColors[pillName];
								await this.plugin.saveSettings();
								this.display(); // Refresh the settings display
							}));
					
					// Style the pill name with background color and rounded appearance
					const pillElement = this.setupPillPreview(setting, pillName, pillValue);
				});
		}
	}

	private setupPillPreview(setting: Setting, name: string, color: string): HTMLElement {
		// Insert pill at the beginning of the setting (left side)
		const pill = setting.settingEl.createSpan('property-pill-preview');
		pill.textContent = name;
		pill.style.backgroundColor = color;
		pill.style.color = 'white'; // Always use white text as specified
		pill.style.padding = '4px 12px';
		pill.style.borderRadius = '12px';
		pill.style.fontSize = '0.85em';
		pill.style.fontWeight = '500';
		pill.style.marginRight = '12px';
		pill.style.display = 'inline-block';
		
		// Insert at the beginning of the setting element
		setting.settingEl.insertBefore(pill, setting.settingEl.firstChild);
		
		return pill;
	}

	private updatePillPreview(pill: HTMLElement, name: string, color: string): void {
		pill.textContent = name;
		pill.style.backgroundColor = color;
		pill.style.color = 'white'; // Always use white text as specified
	}

	private hexToHsl(hex: string): string {
		// Remove # if present
		hex = hex.replace('#', '');
		
		// Parse r, g, b values
		const r = parseInt(hex.substring(0, 2), 16) / 255;
		const g = parseInt(hex.substring(2, 4), 16) / 255;
		const b = parseInt(hex.substring(4, 6), 16) / 255;
		
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		let h = 0, s = 0, l = (max + min) / 2;
		
		if (max === min) {
			h = s = 0; // achromatic
		} else {
			const d = max - min;
			s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
			
			switch (max) {
				case r: h = (g - b) / d + (g < b ? 6 : 0); break;
				case g: h = (b - r) / d + 2; break;
				case b: h = (r - g) / d + 4; break;
			}
			h /= 6;
		}
		
		return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
	}

	private showColorPickerModal(pillName: string, currentColor: string, onColorSelected: (color: string) => void): void {
		const modal = new ColorPickerModal(this.app, pillName, currentColor, onColorSelected);
		modal.open();
	}
}
