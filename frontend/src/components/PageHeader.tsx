import type { ReactNode } from 'react'
import './PageHeader.css'

interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
  aside?: ReactNode
}

export default function PageHeader({
  title,
  subtitle,
  actions,
  aside,
}: PageHeaderProps) {
  return (
    <header className="page-header card">
      <div className="page-header-main">
        <div className="page-header-copy">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {(actions || aside) && (
          <div className="page-header-side">
            {aside ? <div className="page-header-aside">{aside}</div> : null}
            {actions ? <div className="page-header-actions">{actions}</div> : null}
          </div>
        )}
      </div>
    </header>
  )
}
