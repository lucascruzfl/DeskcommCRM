export const usePathname = () => "/app/settings";
export const useRouter = () => ({ push: () => {}, refresh: () => {} });
export const toggleSidebar = async () => {};
export const useAuth = () => ({
  user: { is_platform_admin: false },
  activeOrg: { role: "admin", modulos_ligados: [] },
});
