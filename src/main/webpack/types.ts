
import 'webpack';

declare module 'webpack' {
	interface InputFileSystem {
		readdir(path: string, callback: (err: Error | null, result?: any) => void): void;
		readdirSync(path: string): string[];
		createReadStream(
			path: string,
			options?: {
				start: number;
				end: number;
			}
		): any;
		exists(path: string, callback: (isExist: boolean) => void): void;
		existsSync(path: string): boolean;
		join?(path: string, request: string): string;
		pathToArray?(path: string): string[];
		normalize?(path: string): string;
	}

	namespace loader {
		interface LoaderContext {
			rootContext: string;
		}
	}
}
