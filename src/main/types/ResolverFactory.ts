
import * as ts from 'typescript';

type ResolverFactory = (compilerOptions: ts.CompilerOptions, host: ts.ModuleResolutionHost, resolutionCache: ts.ModuleResolutionCache) => (
	(moduleNames: string[], containingFile: string, reusedNames?: string[]) => (ts.ResolvedModule | undefined)[]
);
/** @internal */
export default ResolverFactory;
