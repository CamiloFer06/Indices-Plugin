import { Plugin, TFile, TFolder, MarkdownView, TAbstractFile, Vault, Notice } from 'obsidian'


export default class Indice extends Plugin {
	private fileHeadersMap: Map<string, string[]> = new Map();

	async onload() {
		this.addCommand({
			id: 'crear-indice',
			name: 'Crear Indice',
			hotkeys: [{ modifiers: ['Mod'], key: 'u' }],
			editorCheckCallback: (checking: boolean) => {
				const note = this.app.workspace.getActiveFile();


				if (note && note.parent) {
					if (!checking) {
						this.print(note.parent, note);
					}
					return true;
				}

				return false;
			},
		});

		this.addCommand({
			id: 'actualizar-indices',
			name: 'Actualizar Indices',
			hotkeys: [{ modifiers: ['Mod'], key: 'q' }],
			checkCallback: (checking: boolean) => {
				const note = this.app.workspace.getActiveFile();

				if (note && note.parent) {

					if (!checking) {
						this.updateIndexNotes(note.parent);
					}

					return true;
				}

				return false;
			}
		})
		this.addCommand({
			id: 'actualizar-todo',
			name: 'Actualizar Todo',
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'u' }],
			callback: async () => {
				await this.updateAll();
				new Notice('Indices Actualizados');
			}
		})

		// Escuchar renombreado de archivos
		this.registerEvent(
			this.app.vault.on('rename', this.handleFileRename.bind(this))
		)
		// Escuchar creación de archivos
		this.registerEvent(
			this.app.vault.on('create', await this.handleFileCreate.bind(this))
		)
		// Escuchar modificaciones de archivos
		this.registerEvent(
			this.app.vault.on('modify', this.handleFileModify.bind(this))
		)

	}

	private async createIndex(activeFolder: TFolder, folderLvl: number, excludeNote?: TFile) {

		if (folderLvl > 6) {
			return ''; //caso base
		} else {


			//obtengo notas guardadas directamente en carpeta
			let files = this.app.vault.getMarkdownFiles().filter(file => file.parent === activeFolder);

			// ordeno las notas alfabeticamente
			files = files.sort((a, b) => a.name.localeCompare(b.name));

			let index = '';
			if (folderLvl !== 0) {
				index += `${'#'.repeat(folderLvl)} ${activeFolder.name}\n`
			}

			//itero sobre las notas
			for (const file of files) {

				//guardo el nombre sin extensión de la nota
				const fileName = file.basename;
				const filePath = file.path.replace(`.${file.extension}`, "");

				// obtengo las tags de la nota
				const metadata = this.app.metadataCache.getFileCache(file);
				const tags = metadata?.tags ? metadata.tags.map(tagObj => tagObj.tag) : [];


				// verifico que exista file.parent, que la nota no tenga la tag #indice o que sea la nota excluida
				if (file.parent && !tags.includes("#indice") && !(file === excludeNote)) {

					//agrego nombre de nota a la lista
					index += `- [[${filePath}|${fileName}]]\n`;

					// leo el contenido de la nota
					const fileContent = await this.app.vault.cachedRead(file);

					// filtro para buscar encabezados
					const headings = this.extractHeaders(fileContent);

					// itero los encabezados y los agrego a la lista
					if (headings) {
						for (const heading of headings) {
							const match = heading.match(/^#+/);
							const hlevel = match ? match[0].length : -1;
							const line = hlevel < 4 ? `${'	'.repeat(hlevel)}- [[${filePath}#${heading.replace(/^#+\s/, '')}|${heading.replace(/^#+\s/, '')}]]\n` : '';
							index += line;

						}
					}
				}


			}

			//obtengo las carpetas directamente en la actual
			const folders = this.app.vault.getAllFolders(false).filter(folder => folder.parent === activeFolder);

			//repito para cada carpeta
			for (const folder of folders) {
				index += '\n'
				index += await this.createIndex(folder, folderLvl + 1)

			}
			return index
		}




	}
	private async print(fold: TFolder, note: TFile) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);


		if (view) {
			const editor = view.editor;
			const content = editor.getValue();


			const index = await this.createIndex(fold, 0, note);

			const regex = /(<!-- inicio índice -->)([\s\S]*?)(<!-- fin índice -->)/;
			const match = content.match(regex);

			if (match) {
				const startPos = editor.offsetToPos(match.index! + match[1].length);
				const endPos = editor.offsetToPos(match.index! + match[0].length - match[3].length);

				const text = `\n#indice\n\n${index}\n`;

				editor.replaceRange(text, startPos, endPos);
			} else {
				const text = `\n<!-- inicio índice -->\n#indice\n\n${index}\n<!-- fin índice -->\n`

				editor.replaceRange(text, editor.getCursor())
			}


		}
	}

	private async updateIndexNotes(activeFolder: TFolder) {

		const indexNotes = this.app.vault.getMarkdownFiles().filter(file => {
			const metadata = this.app.metadataCache.getFileCache(file);
			const tags = metadata?.tags ? metadata.tags.map(tagObj => tagObj.tag) : [];

			// Verificar si la nota está en la carpeta actual y contiene la etiqueta #indice
			if (!file.parent) { return false }
			return activeFolder.path.startsWith(file.parent.path) && tags.includes('#indice');
		})
		let i = 0
		for (const note of indexNotes) {
			if (!note.parent) { return }
			//creo el indice
			const index = await this.createIndex(note.parent, 0);

			// guardo el contenido de la nota
			const content = await this.app.vault.read(note);

			//busco el lugar del indice
			const regex = /(<!-- inicio índice -->)([\s\S]*?)(<!-- fin índice -->)/;

			// rescribo el indice
			const newContent = content.replace(regex, `$1\n#indice\n\n${index}\n$3`);

			// escribo el nuevo contenido en la nota
			await this.app.vault.modify(note, newContent);


			i += 1;

		}
	}

	//  ======== Maneja el renombrado de archivos. ========

	private async handleFileRename(file: TAbstractFile, oldPath: string) {

		if (file instanceof TFile && file.parent) {
			this.updateIndexNotes(file.parent);

			//Actualizar mapa de encabezados
			await this.updateHeaderMapForRenamedFile(file, oldPath)

		} else if (file instanceof TFolder) {
			this.updateIndexNotes(file);
		}

	}
	// Función para actualizar el mapa de encabezados cuando se renombra una nota
	private async updateHeaderMapForRenamedFile(file: TFile, oldPath: string) {
		// Verificar si existe la entrada para el antiguo camino en el mapa
		const headers = this.fileHeadersMap.get(oldPath);

		if (headers) {
			// Eliminar la entrada antigua
			this.fileHeadersMap.delete(oldPath);
		}

		// Extraer encabezados actuales de la nota renombrada
		const content = await this.app.vault.cachedRead(file);
		const newHeaders = this.extractHeaders(content);

		// Agregar nueva entrada al mapa con el nuevo camino
		this.fileHeadersMap.set(file.path, newHeaders);
	}

	// ======== Maneja la creación de archivos ========

	private async handleFileCreate(file: TAbstractFile) {
		if (file instanceof TFile && file.parent) {
			const content = await this.app.vault.cachedRead(file);
			const headings = this.extractHeaders(content);
			this.fileHeadersMap.set(file.path, headings);
			this.updateIndexNotes(file.parent);
		} else if (file instanceof TFolder) {
			this.updateIndexNotes(file);
		}

	}

	// ======== Maneja modificaciones de archivos solo si se detectan cambios en encabezados. ========

	private async handleFileModify(file: TFile) {
		if (file.extension !== 'md' || !file.parent) return; // Solo procesar archivos Markdown con carpeta padre

		const content = await this.app.vault.cachedRead(file);
		const currentHeaders = this.extractHeaders(content);

		// Si el archivo aún no está en el mapa, agregarlo.
		if (!this.fileHeadersMap.has(file.path)) {
			this.fileHeadersMap.set(file.path, currentHeaders);
			this.updateIndexNotes(file.parent);
			return;
		}

		// Comparar encabezados anteriores con los actuales
		const previousHeaders = this.fileHeadersMap.get(file.path) || [];
		if (this.headersHaveChanged(previousHeaders, currentHeaders)) {
			this.updateIndexNotes(file.parent)
		}

		// Actualizar el mapa de encabezados con el estado actual
		this.fileHeadersMap.set(file.path, currentHeaders);
	}


	// ======== Extrae encabezados ========

	private extractHeaders(content: string): string[] {
		// Extraer todos los encabezados (líneas que empiezan con #)
		const headers = content.match(/^#+\s.+$/gm) || [];
		return headers;
	}


	// ======== Compara dos listas de encabezados

	private headersHaveChanged(oldHeaders: string[], newHeaders: string[]): boolean {
		if (oldHeaders.length !== newHeaders.length) return true;
		for (let i = 0; i < oldHeaders.length; i++) {
			if (oldHeaders[i] !== newHeaders[i]) return true;
		}
		return false;
	}

	private async updateAll() {
		const files = this.app.vault.getFiles();
		for (const file of files) {
			this.handleFileModify(file);
		}
	}
}
