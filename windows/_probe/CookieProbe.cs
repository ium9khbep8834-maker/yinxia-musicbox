using System;
using System.Net;

namespace CookieProbe
{
    public static class P
    {
        public static void Main()
        {
            foreach (string dom in new string[] { ".y.qq.com", "y.qq.com", ".qq.com", "qq.com" })
            {
                CookieContainer cc = new CookieContainer();
                Cookie c = new Cookie("uin", "o123", "/", dom);
                try
                {
                    cc.Add(new Uri("https://" + dom.TrimStart('.') + "/"), c);
                }
                catch (Exception ex)
                {
                    Console.WriteLine(dom + " ADD-FAIL " + ex.GetType().Name + " " + ex.Message);
                    continue;
                }
                string h1 = cc.GetCookieHeader(new Uri("https://y.qq.com/cgi-bin/x"));
                string h2 = cc.GetCookieHeader(new Uri("https://u.y.qq.com/cgi-bin/musicu.fcg"));
                Console.WriteLine(dom + " -> y.qq.com=[" + h1 + "] u.y.qq.com=[" + h2 + "]");
            }

            // implicit-domain cookie via Add(Cookie) only
            CookieContainer cc2 = new CookieContainer();
            Cookie c2 = new Cookie("a", "b");
            c2.Domain = "";
            try { cc2.Add(c2); Console.WriteLine("empty-domain add OK"); }
            catch (Exception ex) { Console.WriteLine("empty-domain add FAIL " + ex.GetType().Name); }

            // Add(Cookie) with domain, no Uri
            CookieContainer cc3 = new CookieContainer();
            Cookie c3 = new Cookie("a", "b");
            c3.Domain = ".music.163.com";
            try { cc3.Add(c3); Console.WriteLine("domain-only add OK hdr=" + cc3.GetCookieHeader(new Uri("https://music.163.com/api/x"))); }
            catch (Exception ex) { Console.WriteLine("domain-only add FAIL " + ex.GetType().Name + " " + ex.Message); }
        }
    }
}
