import { ProductionCamerasPage } from './ProductionCamerasPage';
import { ProductionMixersPage } from './ProductionMixersPage';
import { ProductionBridgesPage } from './ProductionBridgesPage';

export function ProductionDevicesPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        padding: '12px 20px 8px',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        flexShrink: 0,
      }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Devices</h2>
      </div>
      <div className="devices-page__columns">
        <div className="devices-page__col">
          <ProductionCamerasPage />
        </div>
        <div className="devices-page__col">
          <ProductionMixersPage />
        </div>
        <div className="devices-page__col">
          <ProductionBridgesPage />
        </div>
      </div>
    </div>
  );
}
