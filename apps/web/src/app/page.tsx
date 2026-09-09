import Link from 'next/link';
import { ArrowRight, CheckCircle2, MapPin, ShieldCheck, Sparkles } from 'lucide-react';
import { AppShell } from '../components/app-shell';
import { ProductGuide } from '../components/product-guide';
import { ServiceGrid } from '../components/service-grid';

export default function Home() {
  return (
    <AppShell>
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={14} /> Home help, without the hassle</div>
          <h1>Small jobs.<br /><i>Big relief.</i></h1>
          <p>Find trusted local professionals for the things you do not want to do alone.</p>
          <div className="hero-actions">
            <Link className="button button-dark" href="/requests/new">Tell us what you need <ArrowRight size={17} /></Link>
            <Link className="text-link" href="/services">Browse services <ArrowRight size={15} /></Link>
          </div>
          <div className="hero-proof"><span><CheckCircle2 size={16} /> Local providers</span><span><ShieldCheck size={16} /> Private by default</span></div>
        </div>
        <div className="hero-aside">
          <div className="hero-aside-top"><MapPin size={18} /><span>Serving your neighbourhood</span></div>
          <div className="route-line"><span className="route-dot" /><span className="route-stroke" /><span className="route-dot route-dot-end" /></div>
          <div className="hero-aside-bottom"><strong>One request</strong><span>Multiple useful offers</span></div>
        </div>
      </section>
      <ProductGuide />
      <section className="home-services">
        <div className="section-label"><span>What can we help with?</span><Link href="/services">View all services <ArrowRight size={15} /></Link></div>
        <ServiceGrid limit={5} />
      </section>
      <section className="home-bottom">
        <div><div className="eyebrow">Made for real life</div><h2>The right person<br /><i>for the right job.</i></h2></div>
        <p>Fixly keeps the admin small and the important details clear, so you can make a confident choice and get on with your day.</p>
      </section>
    </AppShell>
  );
}
