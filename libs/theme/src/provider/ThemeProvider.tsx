import { createContext, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light' | 'system';

type ThemeProviderProps = {
    children: React.ReactNode;
    defaultTheme?: Theme;
    storageKey?: string;
};

type ThemeProviderState = {
    theme: Theme;
    resolvedTheme: 'dark' | 'light';
    setTheme: (theme: Theme) => void;
};

const getSystemTheme = (): 'dark' | 'light' =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

const initialState: ThemeProviderState = {
    theme: 'system',
    resolvedTheme: 'light',
    setTheme: () => null,
};

export const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
    children,
    defaultTheme = 'system',
    storageKey = 'vite-ui-theme',
    ...props
}: ThemeProviderProps) {
    const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(storageKey) as Theme) || defaultTheme);
    const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>(() =>
        theme === 'system' ? getSystemTheme() : theme
    );

    useEffect(() => {
        const root = window.document.documentElement;

        if (theme === 'system') {
            const systemTheme = getSystemTheme();
            root.classList.remove('light', 'dark');
            root.classList.add(systemTheme);
            setResolvedTheme(systemTheme);

            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            const handleChange = (e: MediaQueryListEvent) => {
                const next = e.matches ? 'dark' : 'light';
                root.classList.remove('light', 'dark');
                root.classList.add(next);
                setResolvedTheme(next);
            };
            mediaQuery.addEventListener('change', handleChange);
            return () => mediaQuery.removeEventListener('change', handleChange);
        } else {
            root.classList.remove('light', 'dark');
            root.classList.add(theme);
            setResolvedTheme(theme);
        }
    }, [theme]);

    const value = {
        theme,
        resolvedTheme,
        setTheme: (theme: Theme) => {
            localStorage.setItem(storageKey, theme);
            setTheme(theme);
        },
    };

    return (
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        <ThemeProviderContext.Provider {...props} value={value}>
            {children}
        </ThemeProviderContext.Provider>
    );
}
