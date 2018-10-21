
import ResolverFactory from './ResolverFactory';
import TscConfig from './TscConfig';

import WrappedFs from '../fs/WrappedFs';

/** @internal */
export default interface TscBuildConfig {
	configDirectory: string;
	data: TscConfig;
	resolver: ResolverFactory;
	sourceDestMap: { [destFile: string]: string };
	configFileName?: string;
	extendedCompilerOptions?: object;
	wrappedFs?: WrappedFs | null;
	commonSourceDirectory?: string;
}
